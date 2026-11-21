# RoScout

Live Roblox game stats, revenue estimates, playtime tracking, a friends hub, community tools and
custom backgrounds, right on roblox.com.

## Install

1. Download **[roscout-latest.zip](https://github.com/rhinoplague/roscout-releases/raw/main/downloads/roscout-latest.zip)** (every version is in [downloads/](downloads/)).
2. Unzip it. You'll get a folder called `roscout`. Keep it somewhere it won't get deleted.
3. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `roscout` folder.
5. Open roblox.com.

## Update

When there's a new version, RoScout's toolbar popup shows an **Update available** banner.

1. Click **Download update** in the banner.
2. Unzip it **over your existing `roscout` folder** (replace the files).
3. In `chrome://extensions`, click the reload arrow on RoScout.

Your tracked games, playtime and settings are kept.

## Versions

| Version | Download |
|---|---|
| 2.1.0 | [roscout-2.1.0.zip](https://github.com/rhinoplague/roscout-releases/raw/main/downloads/roscout-2.1.0.zip) |
| 2.0.0 | [roscout-2.0.0.zip](https://github.com/rhinoplague/roscout-releases/raw/main/downloads/roscout-2.0.0.zip) |
| 1.9.0 | [roscout-1.9.0.zip](https://github.com/rhinoplague/roscout-releases/raw/main/downloads/roscout-1.9.0.zip) |
| 1.8.1 | [roscout-1.8.1.zip](https://github.com/rhinoplague/roscout-releases/raw/main/downloads/roscout-1.8.1.zip) |
| 1.8.0 | [roscout-1.8.0.zip](https://github.com/rhinoplague/roscout-releases/raw/main/downloads/roscout-1.8.0.zip) |
| 1.7.0 | [roscout-1.7.0.zip](https://github.com/rhinoplague/roscout-releases/raw/main/downloads/roscout-1.7.0.zip) |

## Privacy

RoScout has no servers and only talks to Roblox (plus this page, to check for updates).
Everything it records stays in your browser. Full policy: [privacy.html](privacy.html).

RoScout is not affiliated with or endorsed by Roblox Corporation.

## Shared player data

The RoScout robot (`collector/collect.mjs`, run by GitHub Actions every 30 minutes) records how many people are playing every game on Roblox's top lists, and keeps following each game for 30 days after it leaves them. The results live on the [`data` branch](https://github.com/rhinoplague/roscout-releases/tree/data), and every copy of RoScout reads them, so everyone sees the same history even for games they never tracked. To always record a game that isn't on Roblox's lists, add its universe ID to `watch.json`.
