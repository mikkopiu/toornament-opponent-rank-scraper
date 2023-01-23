# toornament-opponent-rank-scraper

Simple web scraper to get opponent ranks in a Toornament tournament for a single team.

**NOTE:** Somewhat unreliable: it's scraping + csgostats.gg is behind CloudFlare (CAPTCHA is triggered sometimes)

## Usage

Fetch e.g. Polar Squad in Season 7:

```sh
node ./index.mjs https://www.toornament.com/en_US/tournaments/4191528294501023744/participants/4302047697390280704/
```
