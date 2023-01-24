import puppeteer from 'puppeteer'
import SteamID from 'steamid'
import fetch from 'node-fetch'
import UserAgent from 'user-agents'
import { Console } from 'console'

const humanConsole = new Console(process.stderr)

const MM_RANKS = {
  0: 'N/A',
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

const getEsportalRank = (elo) => {
  switch (true) {
    case elo < 1000:
      return 'Silver'
    case elo < 1100:
      return 'Gold I'
    case elo < 1200:
      return 'Gold II'
    case elo < 1300:
      return 'Veteran I'
    case elo < 1400:
      return 'Veteran II'
    case elo < 1500:
      return 'Master I'
    case elo < 1600:
      return 'Master II'
    case elo < 1700:
      return 'Elite I'
    case elo < 1800:
      return 'Elite II'
    case elo < 1900:
      return 'Pro I'
    case elo < 2000:
      return 'Pro II'
    default:
      return 'Legend'
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @typedef Rank
 * @type {Object}
 * @property {Number} value
 * @property {String} name
 */

/**
 * @typedef FaceitElo
 * @type {Object}
 * @property {String} [current]
 * @property {String} [highest]
 */

/**
 * @typedef Player
 * @type {Object}
 * @property {String} name
 * @property {String} steamId
 * @property {Rank} [currentRank]
 * @property {Rank} [bestRank]
 * @property {FaceitElo} [faceitElo]
 * @property {String} [esportalElo]
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
    // For debugging:
    // page.on('console', (log) => humanConsole.log(log.text()))

    // Gather all opponent names from the matches page
    await page.goto(teamUrl)

    const ownTeamName = await page.evaluate(() => document.querySelector('.match .title .name span').textContent.trim())
    humanConsole.log(`Own team name: ${ownTeamName}`)

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

        await page.goto(`https://csgostats.gg/player/${player.steamId}`, { waitUntil: 'networkidle0' })

        const maxRetries = 5
        let retries = maxRetries
        let isActualPage = await page.evaluate(() => !!document.querySelector('#player-name'))
        // Retry until we get to the actual page, or exhaust retries
        while (!isActualPage) {
          if (retries <= 0) {
            throw new Error('Exhausted retries while attempting to bypass CloudFlare hCaptcha')
          }

          // Back off a bit
          await delay(Math.random() * (maxRetries - retries) * 1000)
          await page.setUserAgent(new UserAgent().toString())
          await page.goto(`https://csgostats.gg/player/${player.steamId}`, { waitUntil: 'networkidle0' })
          isActualPage = await page.evaluate(() => !!document.querySelector('#player-name'))
          retries--
        }

        // MM ranks
        const { currentRank, bestRank } = await page.evaluate((ranks) => {
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
        }, MM_RANKS)
        const playerWithRanks = Object.assign(player, { currentRank, bestRank })

        // FACEIT Elo
        await page.goto(`https://faceitfinder.com/stats/${player.steamId}`)
        playerWithRanks.faceitElo = await page.evaluate(() => {
          const eloImg = document.querySelector('img[alt="ELO"]')
          if (!eloImg) return {}
          const currentElo = eloImg.parentElement.parentElement
            .querySelector('.stats_totals_block_main_value')
            .textContent.trim()
          const currentEloLevel = eloImg.parentElement.parentElement
            .querySelectorAll('.stats_totals_block_item')[0]
            .querySelector('.stats_totals_block_item_value > img')
            .getAttribute('src')
            .replace('/resources/ranks/skill_level_', '')
            .replace('_lg.png', '')
            .trim()
          // Contains pre-formatted data: "1234 (5)"
          const highestEloCombined = eloImg.parentElement.parentElement
            .querySelectorAll('.stats_totals_block_item')[2]
            .querySelector('.stats_totals_block_item_value')
            .textContent.trim()
          return {
            current: `${currentElo} (${currentEloLevel})`,
            highest: highestEloCombined,
          }
        })

        // Esportal Elo
        const playerSteamId3 = new SteamID(player.steamId).accountid // Esportal APIs use this format
        const esportalSearchUrl = `https://api.esportal.com/user_profile/list?id=${playerSteamId3}`
        const esportalProfiles = await (await fetch(esportalSearchUrl)).json()
        if (esportalProfiles === null) {
          playerWithRanks.esportalElo = 'N/A'
        } else {
          const esportalUsername = esportalProfiles[0].username
          const esportalProfileUrl = `https://api.esportal.com/user_profile/get?username=${esportalUsername}`
          const esportalElo = Number((await (await fetch(esportalProfileUrl)).json()).elo)
          playerWithRanks.esportalElo = `${esportalElo} (${getEsportalRank(esportalElo)})`
        }

        opponent.players.push(playerWithRanks)
      }

      opponent.players = players.sort((a, b) => b.currentRank.value - a.currentRank.value)

      // For human-consumption
      humanConsole.log(`${name}:`)
      humanConsole.table(
        opponent.players.reduce((acc, { name, ...x }) => {
          acc[name] = {
            'ID': x.steamId,
            'Current Rank': x.currentRank?.name ?? 'N/A',
            'Best Rank': x.bestRank?.name ?? 'N/A',
            'Current FACEIT Elo': x.faceitElo.current ?? 'N/A',
            'Highest FACEIT Elo': x.faceitElo.highest ?? 'N/A',
            'Current Esportal Elo': x.esportalElo ?? 'N/A',
          }
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
