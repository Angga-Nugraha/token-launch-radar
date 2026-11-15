# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Angga-Nugraha/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Angga-Nugraha/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every protocol with no token yet, ranked by what its launch would be worth.

DefiLlama's watchlist keeps 40 protocols at or above $50M TVL. This radar keeps them
all — and adds every other protocol that passes the same rule, including 20 above the
$50M floor that the watchlist missed, among them Sentora Curator ($2.76B TVL, ranked
#2). The rule: no token recorded, and not a wrapped, staked or bridged product of a
token that already trades. Every row carries an implied value and a farm plan. A
protocol that records no token is said to record none, never that it has none.

## What the program does

`main.ts` (Node 22, standard library only) reads the sealed snapshot at
`/input/snapshot.json`, scores every pre-token protocol with the model in
`lib/model.ts`, and writes:

| Output | Contents |
| --- | --- |
| `board.json` | 198 rows, rank 1..198, each with an implied value and a 7-step farm plan |
| `data.js` | the same board in compact form, for the dashboard |
| `dashboard/` | a static page: ranking, filters, per-protocol detail, the model |
| `screenshots/` | the board, a protocol detail view, a filtered view |
| `dossier.json` | the summary the judge reads, built by the vendored make.fun library |

## The model (radar-2)

```
implied = tvl_usd × multiple × (1 + clamp(change_7d, -25, +25) / 100 × 0.5)
        × (0.7 + min(age_days, 1095) / 1095 × 0.3)
        × (1 + 0.02 × min(chains - 1, 4))
```

The category multiple is the median market-cap-per-TVL of the snapshot's own
token-bearing protocols in that category, shrunk toward the whole-market median
(0.20×) where the category has few comparables, and clamped to [0.05, 2]. The
dashboard shows the calibration table — every multiple, its comparables and its
median — and the page recomputes each row's implied value from the snapshot
figures, so the screenshots, the code and the board agree.

The board is a radar, not a promise: implied value is a model's estimate of what
a launch could be worth, not a price, and a launch may never happen.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

## Layout

- `main.ts` — entrypoint: read the snapshot, write the board, copy the dashboard and screenshots, write the dossier
- `lib/model.ts` — the model: eligibility, calibration, implied value, farm plans, the board
- `vendor/makefun-board.ts` — the make.fun dossier library, verbatim from the competition kit
- `dashboard/` — `index.html`, `app.css`, `app.js`: the static page, no network
- `screenshots/` — the three hand-in views
- `.makefun/owner.json` — the payout wallet

## Entry

Built for the make.fun competition "Build the best token launch radar"
(token-radar-01): https://make.fun/bounty/token-radar-01. The program runs twice
with no network and writes identical bytes on both runs.
