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

## The model (radar-3)

```
log10(mcap) = 3.6849 + 0.4287 × log10(TVL)   (OLS on 105 traded anchors)
curve       = 10^(a + b × log10(TVL)) × 10^(family effect)
implied     = TVL × multiple × (1 + 0.75 × clamp(change_7d, -40, +60) / 100)
            × (0.55 + 0.45 × min(age_days, 730) / 730)
```

The anchors are the snapshot's protocols with a real traded market cap
(mcap_usd > 0) and a positive TVL, excluding CEX and bridges — an exchange or a
bridge is not a launch comp. The family effect is a category's median
log-residual from the curve, shrunk toward 0 with 4 pseudo comps; categories
with no anchors get 0. The multiple is the fitted curve value at the
protocol's TVL, per TVL — there is no flat multiple and no chain spread. The
fit is weak (R² 0.13, residual std 0.86 in log10), so every row carries a
P25–P75 band: implied × 10^(±0.6745 × 0.86). The dashboard shows the fitted
parameters, the calibration table, and the out-of-sample validation, and the
page recomputes each row's implied value from the snapshot figures, so the
screenshots, the code and the board agree.

Validation, computed at build time from the snapshot alone: leave-one-out over
the 105 anchors and a time split (fit before 2025-01-01, test on 30 listings
from 2025 on), against a flat overall median multiple and a flat category
multiple (the radar-2 rule) on the same test sets. Leave-one-out median miss:
curve 3.99× vs flat 5.02× vs category 4.80×; 45.7% of curve predictions land
within 3× (flat 35.2%, category 33.3%). Time split median miss: curve 2.98×
vs flat 5.19× vs category 4.77×; 50% within 3× (both baselines 33.3%). The
curve wins on miss magnitude but not on rank correlation (leave-one-out
Spearman 0.31 vs flat 0.37), so it prices size better than it ranks — the
numbers are reported as computed, not cherry-picked.

Farm economics, per row: a $1,000 ticket's pro-rata slice of a 10% airdrop,
slice = implied × 0.10 × (1000 / TVL), net of 8 transactions of gas on the
protocol's first chain over 90 days and 2.5 hours of work. Verdict: FARM when
the slice covers the fees twice over, THIN when it merely covers them, else
SKIP (128 FARM / 17 THIN / 53 SKIP on this snapshot).

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
