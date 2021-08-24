const puppeteer = require('puppeteer')
const UserAgent = require('user-agents')
const { Console } = require('console')
const humanConsole = new Console(process.stderr)

const RANKS = {
  0: 'Missing',
  1: 'S1',
  2: 'S2',
  3: 'S3',
  4: 'S4',
  5: 'SE',
  6: 'SEM',
  7: 'GN1',
  8: 'GN2',
  9: 'GN3',
  10: 'GNM',
  11: 'MG1',
  12: 'MG2',
  13: 'MGE',
  14: 'DMG',
  15: 'LE',
  16: 'LEM',
  17: 'SMFC',
  18: 'GE',
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @typedef Rank
 * @type {Object}
 * @property {Number} value
 * @property {String} name
 */

/**
 * @typedef Player
 * @type {Object}
 * @property {String} name
 * @property {String} steamId
 * @property {Rank} [currentRank]
 * @property {Rank} [bestRank]
 * @property {String} [faceitElo]
 */

/**
 * @typedef Opponent
 * @type {Object}
 * @property {Player[]} players
 * @property {String} matchUrl
 */

/**
 * @param {String} teamUrl
 */
async function getOpponents(teamUrl) {
  try {
    const browser = await puppeteer.launch()
    const page = await browser.newPage()

    // Gather all opponent names from the matches page
    await page.goto(teamUrl)

    const ownTeamName = await page.evaluate(() => document.querySelector('.match .title .name span').textContent.trim())

    /** @type {Object.<string, Opponent>} */
    const opponents = await page.evaluate(
      (ownTeamName) =>
        Array.from(document.querySelectorAll('.main-container .content .content .size-1-of-5 a')).reduce(
          (prevOpponents, opponentEl) => {
            const name = Array.from(opponentEl.querySelectorAll('.opponent .name'))
              .map((el) => el.textContent.trim())
              .find((name) => name !== ownTeamName)

            if (!name) {
              throw new Error("Something went wrong, can't find opponent team name")
            }

            if (!(name in prevOpponents)) {
              prevOpponents[name] = {
                players: [],
                matchUrl: `https://www.toornament.com${opponentEl.getAttribute('href').replace(/\/$/, '')}/players`,
              }
            }

            return prevOpponents
          },
          {}
        ),
      ownTeamName
    )

    for (const [name, opponent] of Object.entries(opponents)) {
      // Don't abuse the website
      await delay(Math.random() * 2000)

      // Gather all player names and IDs from the match page
      await page.goto(opponent.matchUrl)

      /** @type {Player[]} */
      const players = await page.evaluate(
        (ownTeamName) =>
          Array.from(
            Array.from(document.querySelectorAll('.main-container .content .content .size-1-of-2'))
              .find((el) => el.querySelector('h3').textContent.trim() !== ownTeamName)
              .querySelectorAll('.vertical.spacing-medium > .size-content:nth-child(odd)')
          ).map((el) => ({
            name: el.querySelector('.text.bold').textContent.trim(),
            steamId: el.querySelector('.steam_player_id').textContent.trim().split(' ').pop(),
          })),
        ownTeamName
      )

      for (const player of players) {
        // Don't abuse the website
        await delay(Math.random() * 5000)

        // csgostats.gg is protected by CloudFlare but using a random User Agent should avoid triggering the hCaptcha
        await page.setUserAgent(new UserAgent().toString())

        await page.goto(`https://csgostats.gg/player/${player.steamId}`)

        let retries = 5
        let isActualPage = await page.evaluate(() => !!document.querySelector('#player-name'))
        // Retry until we get to the actual page, or exhaust retries
        while (!isActualPage) {
          if (retries <= 0) {
            throw new Error('Exhausted retries while attempting to bypass CloudFlare hCaptcha')
          }

          // Back off a bit
          await delay(Math.random() * (5 - retries) * 1000)
          await page.setUserAgent(new UserAgent().toString())
          await page.goto(`https://csgostats.gg/player/${player.steamId}`)
          retries--
        }

        const playerWithRanks = Object.assign(
          player,
          ({ currentRank, bestRank } = await page.evaluate((ranks) => {
            const currentRankValue =
              Number(
                document
                  .querySelector('img[src^="https://static.csgostats.gg/images/ranks/"][width="92"]')
                  ?.getAttribute('src')
                  .replace('https://static.csgostats.gg/images/ranks/', '')
                  .replace('.png', '')
              ) || 0
            const bestRankValue =
              Number(
                document
                  .querySelector('img[src^="https://static.csgostats.gg/images/ranks/"][height="24"]')
                  ?.getAttribute('src')
                  .replace('https://static.csgostats.gg/images/ranks/', '')
                  .replace('.png', '')
              ) ||
              currentRankValue ||
              0
            return {
              currentRank: {
                value: currentRankValue,
                name: ranks[currentRankValue],
              },
              bestRank: {
                value: bestRankValue,
                name: ranks[bestRankValue],
              },
            }
          }, RANKS))
        )

        await page.goto(`https://faceitfinder.com/profile/${player.steamId}`)
        playerWithRanks.faceitElo = await page.evaluate(() => document.querySelectorAll('.account-faceit-stats-single strong')[1].textContent) // ELO

        opponent.players.push(playerWithRanks)
      }

      opponent.players = players.sort((a, b) => b.currentRank.value - a.currentRank.value)

      // For human-consumption
      humanConsole.log(`${name}:`)
      humanConsole.table(
        opponent.players.reduce((acc, { name, ...x }) => {
          acc[name] = { 'Current Rank': x.currentRank.name, 'Best Rank': x.bestRank.name, 'FACEIT Elo': x.faceitElo }
          return acc
        }, {})
      )
    }

    // For machine-consumption
    console.log(JSON.stringify(opponents))

    await browser.close()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}

getOpponents(process.argv[2])
