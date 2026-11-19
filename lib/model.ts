// Token Radar model radar-4: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot's own watchlist rule would keep: no token
// recorded, and not a wrapped, staked or bridged product of a token that already trades. The
// watchlist is the floor (40 protocols at or above $50M TVL); the board adds every other protocol
// that passes the same rule below the floor (158 more here), because the radar exists to find the
// early ones. A protocol that records no token is said to record none, never that it has none.
//
// Implied value is a fitted size curve, not a flat multiple. A flat median mcap/TVL multiple
// prices a $2.8B-TVL protocol as if it were a small one; traded tokens do not scale that way.
// radar-4 fits, on the snapshot's own traded anchors, by Huber IRLS (c = 1.345, scale
// 1.4826 x MAD about the median residual, refitted every iteration):
//
//   log10(mcap) = a + b * log10(TVL)          (anchors: mcap_usd > 0, tvl_usd > 0,
//                                              excluding CEX, Bridge and Canonical Bridge —
//                                              an exchange or a bridge is not a launch comp)
//   curve       = 10^(a + b * log10(TVL)) * 10^(family effect)
//   family effect = median log-residual of the protocol's category, shrunk toward 0 with
//                   12 pseudo comps: effect * n / (n + 12). Categories with fewer than 3
//                   anchors get effect 0, so one extreme anchor can never set an effect.
//   multiple    = curve / TVL                  (the fitted curve value at this TVL, per TVL;
//                                              the only multiple the model publishes, so the
//                                              dashboard can still recompute TVL x multiple x ...)
//   growth      = 1 + 0.75 * clamp(change_7d, -40, +60) / 100
//   age         = 0.55 + 0.45 * min(age_days, 730) / 730   (age unknown: 365 days)
//   implied     = max(1, round(curve * growth * age))
//               = max(1, round(TVL * multiple * growth * age))
//
// Growth and age are fixed multipliers carried over from radar-3, NOT fitted regressors: a
// multivariate fit with growth and age as regressors was tried and rejected on out-of-sample
// evidence (time-split miss 9.94x-11.54x, Spearman ~0). The full fit is
// log10(mcap) = 3.5464 + 0.4470 * log10(TVL), R^2 0.1284, residual std 0.8600.
//
// The curve is validated out of sample at build time (see validate()): leave-one-out over the
// anchors, and a time split (fit before 2025-01-01, test on listings from 2025 on), each against
// two baselines on the same test sets — a flat overall median multiple, and a flat category
// multiple (the radar-2 rule). The same curve-only predictions feed the walk-forward validation
// (5 origins by listed_at) and the ablation table, so every validation number is comparable.
// The numbers are embedded in data.js, not hand-typed.
//
// Uncertainty: the P25–P75 band is implied * 10^(+/-0.6745 * residual_std) — the central half of
// a log-normal residual distribution with the fitted residual dispersion. Whether the bands
// actually hold is measured out of sample (see bandsHold()).
//
// Farm economics: a $1,000 ticket buys a dollar-days slice of a 10% airdrop. The protocol's
// TVL is taken to have grown in a straight line from zero at listing, so its lifetime
// dollar-days are TVL * age_days / 2 and each farm day counts as half a day at today's TVL;
// your day-equivalents are min(hold_days, age_days) / 2, never more than the protocol has
// existed. slice = implied * 0.10 * ticket * min(hold, age) / (TVL * age). Fees are 8
// transactions over the hold (30/45/60 days by age) at the first chain's per-transaction gas;
// the T-bill yield forgone (4% annual over the hold) is deducted as well. net = slice - fees
// - T-bill. Verdict: FARM when net > 0 and slice >= 2 * (fees + T-bill), THIN when net > 0,
// else SKIP. Break-even launch odds are (fees + T-bill) / slice; "pays from $X ticket" is the
// smallest ticket whose net is positive. All assumptions are stated on the page.
//
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  chain_bonus: number;
  chain_bonus_max: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.75,
  growth_floor: -40,
  growth_cap: 60,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 730,
  unknown_age_days: 365,
  // The multiple is the fitted curve value at the protocol's TVL, not a calibrated ratio:
  // these bounds only guard against a degenerate fit and never bind in practice.
  multiple_floor: 0.0001,
  multiple_cap: 1000,
  // No chain spread in radar-3: the curve already prices size, and chain count added noise.
  chain_bonus: 0,
  chain_bonus_max: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-4';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Pseudo comps shrinking each category's family effect toward 0. */
export const EFFECT_PSEUDO_COUNT = 12;

/** Categories with fewer than this many anchors get family effect 0. */
export const EFFECT_MIN_N = 3;

/** Huber IRLS tuning constant. */
export const HUBER_C = 1.345;

/** T-bill yield forgone, annual, deducted from every farm's net. */
export const TBILL_RATE = 0.04;

/** The farm ticket, the transactions it takes, and the hours it takes (stated assumptions). */
export const FARM_TICKET_USD = 1000;
/** The ticket the best-farms table is ranked on. */
export const FARM_TICKET_10K_USD = 10000;
export const FARM_TX_COUNT = 8;
export const FARM_HOURS = 2.5;
/** The share of implied value a launch airdrops, in the farm slice. */
export const FARM_AIRDROP_SHARE = 0.1;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row's farm economics: a dollar-days slice of a 10% airdrop, net of gas and T-bill yield forgone. */
export interface FarmEconomics {
  ticket_usd: number;
  /** Hold in days: 60 under 180 days old, 45 under a year, else 30 (unknown age: 30). */
  farm_days: number;
  /** Days the ticket counts at today's TVL: min(farm_days, age_days) / 2 (linear TVL growth). */
  day_equivalents: number;
  /** Dollar-days slice of a 10% airdrop for the ticket. */
  slice_usd: number;
  /** The slice a launch counting only balances on the day would pay (pro-rata by ticket/TVL). */
  slice_snapshot_usd: number;
  fees_usd: number;
  /** T-bill yield forgone: 4% annual on the ticket over the hold. */
  tbill_usd: number;
  total_cost_usd: number;
  hours: number;
  net_usd: number;
  per_hour_usd: number;
  /** Launch probability at which net is 0: (fees + T-bill) / slice; null when the slice is 0. */
  breakeven_odds: number | null;
  /** Smallest ticket with net > 0; null when no ticket pays (fees outrun the slice). */
  pays_from_usd: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  /** The same economics on a $10,000 ticket (fees do not scale, T-bill and slice do). */
  slice_10k_usd: number;
  net_10k_usd: number;
  per_hour_10k_usd: number;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    family_effect: number;
    age_days: number | null;
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  p25_usd: number;
  p75_usd: number;
  multiple: number;
  family_effect: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm: FarmEconomics;
  /** The 8 farm steps (action, cost, time), computed at build time. */
  farm_steps: FarmStep[];
  /** Rank range over 200 bootstrap refits of the curve. */
  rank_min: number;
  rank_max: number;
  /** Share of the 200 refits in which this row stays in the top 20. */
  top20_share: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  fdv_tvl: number | null;
}

/** One category's calibration: its shrunk family effect on the log-log curve. */
export interface CalibrationRow {
  category: string;
  comparables: number;
  median_residual: number | null;
  effect: number;
  effect_multiplier: number;
}

/** The fitted log-log size curve and its per-category effects. */
export interface CurveFit {
  anchors: number;
  intercept: number;
  slope: number;
  residual_std: number;
  r_squared: number;
  effects: Map<string, { n: number; median_residual: number; effect: number }>;
}

/** One validation method's scores: median miss ratio, share within 2x/3x, rank correlation. */
export interface ValidationMetrics {
  n: number;
  median_miss: number;
  within_2x_pct: number;
  within_3x_pct: number;
  spearman: number;
}

/** Curve vs baselines on one test set. */
export interface ValidationComparison {
  curve: ValidationMetrics;
  flat_multiple: ValidationMetrics;
  category_multiple: ValidationMetrics;
}

/** Out-of-sample validation, computed at build time from the snapshot alone. */
export interface Validation {
  anchors: number;
  loo: { n: number } & ValidationComparison;
  time_split: { split: string; train_n: number; test_n: number } & ValidationComparison;
}

/** One method's out-of-sample scores, Spearman to 3 decimals so 0.338 reads as 0.338. */
export interface ValidationMetrics3 {
  n: number;
  median_miss: number;
  within_2x_pct: number;
  within_3x_pct: number;
  spearman: number;
}

/** Walk-forward validation: 5 origins by listed_at, curve-only predictions (same basis as LOO). */
export interface WalkForwardOrigin {
  fraction: number;
  train_n: number;
  test_n: number;
  curve: ValidationMetrics3;
  flat_multiple: ValidationMetrics3;
  /** The shipped board formula (curve x growth x maturity) on the same origin, for reference. */
  board: ValidationMetrics3;
}

export interface WalkForward {
  /** Dated anchors, sorted by listed_at; each origin trains on the first fraction, tests the rest. */
  origins: WalkForwardOrigin[];
  /** Pooled over all 120 origin tests (each dated anchor is tested up to 5 times). */
  overall_curve: ValidationMetrics3;
  overall_flat: ValidationMetrics3;
  overall_board: ValidationMetrics3;
  note: string;
}

/** One ablation rung: a model term added to the previous rung, curve-only predictions. */
export interface AblationRung {
  name: string;
  basis: string;
  loo_miss: number;
  loo_within_3x_pct: number;
  loo_spearman: number;
  wf_miss: number;
  wf_within_3x_pct: number;
  delta_loo: number;
  delta_wf: number;
  /** Paired-bootstrap SE (2000 draws, seed 1) of the LOO-miss difference vs the compared rung. */
  se: number;
  compared_to: string;
  rule: 'KEPT' | 'BASELINE';
  rule_detail: string;
}

/** One rejected try: same LOO / walk-forward / time-split machinery, with the reason it lost. */
export interface AblationRejected {
  name: string;
  basis: string;
  loo_n: number;
  loo_miss: number | null;
  loo_within_3x_pct: number | null;
  loo_spearman: number | null;
  wf_n: number;
  wf_miss: number | null;
  ts_n: number;
  ts_miss: number | null;
  ts_spearman: number | null;
  /** Paired-bootstrap SE (2000 draws, seed 1) of the LOO-miss difference vs the final rung. */
  se: number | null;
  compared_to: string;
  rule: 'REJECTED';
  reason: string;
}

export interface Ablation {
  keep_rule: string;
  rungs: AblationRung[];
  rejected: AblationRejected[];
}

/** Rank stability over 200 bootstrap refits of the curve (seed 7). */
export interface RankRanges {
  refits: number;
  seed: number;
  /** Top-20 rows that stay top 20 in at least 80% of the refits. */
  top20_stable: number;
  top20_total: number;
  summary: string;
}

/** Whether the P25–P75 / P10–P90 bands actually contain the truth, measured on LOO predictions. */
export interface BandsHold {
  n: number;
  p25_p75_pct: number;
  p10_p90_pct: number;
  aim_p25_p75: number;
  aim_p10_p90: number;
  basis: string;
}

/** How far the ranking moves off pure TVL order. */
export interface NotTvlAlone {
  count: number;
  total: number;
  text: string;
}

/** The 758-protocol ledger: every snapshot protocol placed, counts summing to 758. */
export interface Ledger {
  total: number;
  ranked: number;
  token_trades: number;
  token_on_record: number;
  set_aside_total: number;
  set_aside: {
    bridge: number;
    liquid_staking: number;
    exchange_custody: number;
    versioned_listing: number;
    wrapped_staked: number;
    kin_of_token: number;
  };
}

/** A protocol whose token trades (market cap > 0). */
export interface TradedRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

/** A protocol that records a token but has no traded market cap. */
export interface OnRecordRow {
  slug: string;
  name: string;
  category: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** A pre-token protocol set aside by rule, with the rule that set it aside. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  reason: 'bridge' | 'liquid_staking' | 'exchange_custody' | 'versioned_listing' | 'wrapped_staked' | 'kin_of_token';
}

/** One of the best farms, ranked by net on a $10,000 ticket. */
export interface BestFarm {
  rank: number;
  slug: string;
  name: string;
  ticket_usd: number;
  slice_usd: number;
  fees_usd: number;
  tbill_usd: number;
  hours: number;
  days: number;
  net_usd: number;
  per_hour_usd: number;
}

/** Farming every FARM + THIN row at the $1,000 ticket, summed. */
export interface Portfolio {
  ticket_usd: number;
  farm_count: number;
  thin_count: number;
  farm_thin_count: number;
  costs_usd: number;
  net_usd: number;
  hours: number;
}

/** The KPI strip: one line per card. */
export interface Kpis {
  ranked: number;
  implied_total_usd: number;
  loo_miss: number;
  ts_miss: number;
  wf_miss: number;
  range_holds_p25_p75_pct: number;
  worth_farming: number;
  best_per_hour_usd: number;
  best_per_hour_10k_usd: number;
}

/** One traded anchor, plotted on the scatter: the protocol's TVL and market cap. */
export interface AnchorPoint {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
}

/** Everything the dashboard needs: the board, the live set, the calibration, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  calibration: CalibrationRow[];
  overall_multiple: number;
  curve: { anchors: number; intercept: number; slope: number; residual_std: number; r_squared: number };
  validation: Validation;
  walk_forward: WalkForward;
  ablation: Ablation;
  rank_ranges: RankRanges;
  bands_hold: BandsHold;
  not_tvl_alone: NotTvlAlone;
  ledger: Ledger;
  traded: TradedRow[];
  on_record: OnRecordRow[];
  set_aside: SetAsideRow[];
  best_farms: BestFarm[];
  portfolio: Portfolio;
  kpis: Kpis;
  rows: RadarRow[];
  live: LiveRow[];
  anchors: AnchorPoint[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** Round to 4 decimals: the multiple the model publishes is the multiple it scores with. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Round to 2 decimals: money in the farm economics. */
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted array of numbers. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Categories that are not launch comps: an exchange or a bridge is not a pre-token launch. */
const ANCHOR_EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge']);

/**
 * The traded anchors the curve is fitted on: protocols with a real traded market cap
 * (mcap_usd > 0 — the snapshot records 0 and even -1 for dead listings) and a positive TVL,
 * excluding CEX and bridges. In this snapshot that is 105 protocols.
 */
export function tradedAnchors(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !ANCHOR_EXCLUDED_CATEGORIES.has(p.category ?? ''),
  );
}

/** Round to 3 decimals: Spearman in the new validation tables. */
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;

/** Weighted least squares for y = a + b*x, by weighted means (no matrix inversion). */
function wls2(xs: number[], ys: number[], ws: number[]): [number, number] {
  let sw = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < xs.length; i++) {
    sw += ws[i]!;
    mx += ws[i]! * xs[i]!;
    my += ws[i]! * ys[i]!;
  }
  if (sw === 0) return [0, 0];
  mx /= sw;
  my /= sw;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += ws[i]! * (xs[i]! - mx) ** 2;
    sxy += ws[i]! * (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return [my - slope * mx, slope];
}

/**
 * Fit log10(mcap) = a + b*log10(TVL) by Huber IRLS (c = 1.345) on `list`, with shrunk
 * category effects. Each iteration refits weighted least squares with weights 1 for
 * |residual| <= c * s and c * s / |residual| beyond it, where s = 1.4826 * MAD about the
 * median residual; it stops when both coefficients move less than 1e-10 (at most 100
 * iterations). The extremes (Rain +2.81 log residual, 400x FDV/TVL) are downweighted,
 * never named or dropped. Category effect: the median log-residual of the category's
 * anchors, shrunk toward 0 with EFFECT_PSEUDO_COUNT pseudo comps; categories with fewer
 * than EFFECT_MIN_N anchors get effect 0.
 */
export function fitCurve(list: SnapshotProtocol[], effectK: number = EFFECT_PSEUDO_COUNT, effectMinN: number = EFFECT_MIN_N): CurveFit {
  const xs = list.map((p) => Math.log10(p.tvl_usd));
  const ys = list.map((p) => Math.log10(p.mcap_usd!));
  const n = list.length;
  const ones = xs.map(() => 1);
  let [intercept, slope] = wls2(xs, ys, ones);
  for (let iter = 0; iter < 100; iter++) {
    const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]!));
    const med = median(residuals.slice().sort((a, b) => a - b));
    const mad = median(residuals.map((r) => Math.abs(r - med)).sort((a, b) => a - b));
    const s = 1.4826 * mad;
    if (!(s > 0)) break;
    const ws = residuals.map((r) => {
      const u = Math.abs(r) / s;
      return u <= HUBER_C ? 1 : HUBER_C / u;
    });
    const [nextIntercept, nextSlope] = wls2(xs, ys, ws);
    const moved = Math.max(Math.abs(nextIntercept - intercept), Math.abs(nextSlope - slope));
    intercept = nextIntercept;
    slope = nextSlope;
    if (moved < 1e-10) break;
  }
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]!));
  const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
  const ssr = residuals.reduce((sum, r) => sum + r * r, 0);
  const sst = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
  const residualStd = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
  const rSquared = sst === 0 ? 0 : 1 - ssr / sst;
  const byCat = new Map<string, number[]>();
  list.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const rs = byCat.get(key) ?? [];
    rs.push(residuals[i]!);
    byCat.set(key, rs);
  });
  const effects = new Map<string, { n: number; median_residual: number; effect: number }>();
  for (const [cat, rs] of byCat) {
    const med = median(rs.slice().sort((a, b) => a - b));
    const effect = rs.length < effectMinN ? 0 : med * (rs.length / (rs.length + effectK));
    effects.set(cat, { n: rs.length, median_residual: med, effect });
  }
  return { anchors: n, intercept, slope, residual_std: residualStd, r_squared: rSquared, effects };
}

/** The curve's market-cap prediction for a protocol (before growth and age). */
function curveValue(fit: CurveFit, p: SnapshotProtocol): number {
  const logTvl = p.tvl_usd > 0 ? Math.log10(p.tvl_usd) : 0;
  const effect = fit.effects.get(p.category ?? 'Other')?.effect ?? 0;
  return 10 ** (fit.intercept + fit.slope * logTvl + effect);
}

/** The calibration: the fitted curve, its category effects, and the anchors' median multiple. */
export interface Calibration {
  overall: number;
  curve: CurveFit;
  byCategory: Map<string, { n: number; median_residual: number | null; effect: number }>;
}

/** A calibration built from a fitted curve (the full fit, or a bootstrap refit). */
export function calibrationFromCurve(snapshot: Snapshot, curve: CurveFit): Calibration {
  const anchors = tradedAnchors(snapshot);
  const multiples = anchors.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const overall = multiples.length > 0 ? median(multiples) : 0.2;
  const byCategory = new Map<string, { n: number; median_residual: number | null; effect: number }>();
  for (const cat of new Set(snapshot.protocols.map((p) => p.category ?? 'Other'))) {
    const e = curve.effects.get(cat);
    byCategory.set(cat, e === undefined ? { n: 0, median_residual: null, effect: 0 } : { n: e.n, median_residual: e.median_residual, effect: e.effect });
  }
  return { overall, curve, byCategory };
}

export function calibrate(snapshot: Snapshot): Calibration {
  const anchors = tradedAnchors(snapshot);
  const curve = fitCurve(anchors);
  return calibrationFromCurve(snapshot, curve);
}

/** The growth multiplier for a protocol: 1 + 0.75 * clamped 7d change. */
export function growthMultiplier(protocol: SnapshotProtocol, model: ModelConstants = MODEL): number {
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  return 1 + (growthPct / 100) * model.growth_weight;
}

/** The maturity multiplier for an age in days: 0.55 + 0.45 * min(age, 730) / 730. */
export function maturityMultiplier(age: number | null, model: ModelConstants = MODEL): number {
  const ageForModel = age ?? model.unknown_age_days;
  return model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  cal: Calibration,
  model: ModelConstants = MODEL,
): { implied: number; multiple: number; multipleN: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; familyEffect: number; p25: number; p75: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const entry = cal.byCategory.get(protocol.category ?? 'Other');
  const multipleN = entry !== undefined ? entry.n : 0;
  const familyEffect = entry !== undefined ? entry.effect : 0;
  // The multiple is the fitted curve value at this TVL, per TVL — rounded to 4 decimals, and
  // the model scores with the rounded value, so the dashboard's recompute agrees exactly.
  const rawMultiple = protocol.tvl_usd > 0 ? curveValue(cal.curve, protocol) / protocol.tvl_usd : 0;
  const multiple = round4(Math.min(model.multiple_cap, Math.max(model.multiple_floor, rawMultiple)));
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = growthMultiplier(protocol, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainMult = 1 + model.chain_bonus * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_bonus_max);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  // P25–P75 band: the central half of a log-normal residual distribution, 0.6745 sigma each way.
  const band = 10 ** (0.6745 * cal.curve.residual_std);
  const p25 = Math.max(1, Math.round(implied / band));
  const p75 = Math.max(1, Math.round(implied * band));
  return { implied, multiple, multipleN, growthPct, growthMult, maturityMult, chainMult, familyEffect, p25, p75, age };
}

/** What one transaction costs on a chain, in dollars: the midpoint of the gasFor band. */
export function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 5.5;
  if (chain === 'Solana') return 0.025;
  if (chain === 'Bitcoin') return 3;
  if (chain === 'Tron') return 2;
  if (['Arbitrum', 'Optimism', 'Base', 'Ink', 'Blast', 'Mode', 'Zora', 'Unichain', 'World Chain', 'Scroll', 'Linea', 'Polygon zkEVM', 'Mantle', 'Manta', 'Fraxtal', 'Abstract', 'Soneium', 'Berachain'].includes(chain)) return 0.15;
  if (['Binance', 'Avalanche', 'Polygon', 'Gnosis', 'Fantom', 'Celo', 'Kava', 'Sei', 'Sui', 'Aptos', 'Near', 'Starknet', 'zkSync Era'].includes(chain)) return 0.25;
  return 0.5;
}

/**
 * The farm economics for one row: a ticket's dollar-days slice of a 10% airdrop, net of 8
 * transactions of gas on the protocol's first chain over the hold and the T-bill yield
 * forgone (4% annual over the hold), for 2.5 hours of work. The slice is weighted by
 * dollar-days: the protocol's TVL is taken to have grown in a straight line from zero at
 * listing, so its lifetime dollar-days are TVL * age / 2 and each farm day counts as half
 * a day at today's TVL; your day-equivalents are min(hold, age) / 2, so a protocol younger
 * than the hold can never pay more than the pro-rata slice. FARM when the slice covers
 * the total cost twice over, THIN when it merely covers it.
 */
export function farmEconomics(p: SnapshotProtocol, implied: number, age: number | null): FarmEconomics {
  const hold = holdDaysFor(age);
  const ageForSlice = age ?? MODEL.unknown_age_days;
  const countedDays = Math.min(hold, Math.max(ageForSlice, 0));
  const dayEquivalents = Math.round((countedDays / 2) * 10) / 10;
  const sliceRaw = p.tvl_usd > 0 && ageForSlice > 0 ? implied * FARM_AIRDROP_SHARE * (FARM_TICKET_USD * countedDays) / (p.tvl_usd * ageForSlice) : 0;
  const sliceSnapshotRaw = p.tvl_usd > 0 ? implied * FARM_AIRDROP_SHARE * (FARM_TICKET_USD / p.tvl_usd) : 0;
  const fees = round2(FARM_TX_COUNT * gasUsd(p.chains.length > 0 ? p.chains[0]! : ''));
  const tbill = round2(FARM_TICKET_USD * TBILL_RATE * (hold / 365));
  const totalCost = round2(fees + tbill);
  const slice = round2(sliceRaw);
  const net = round2(sliceRaw - fees - tbill);
  const perHour = round2(net / FARM_HOURS);
  const breakeven = sliceRaw > 0 ? round4((fees + tbill) / sliceRaw) : null;
  // Smallest ticket with net > 0: net(ticket) = ticket * (sliceRaw/1000 - TBILL_RATE*hold/365) - fees.
  const perDollar = sliceRaw / FARM_TICKET_USD - TBILL_RATE * (hold / 365);
  const paysFrom = perDollar > 0 ? Math.ceil(fees / perDollar) : null;
  const verdict: FarmEconomics['verdict'] = net > 0 && sliceRaw >= 2 * totalCost ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
  const slice10Raw = sliceRaw * (FARM_TICKET_10K_USD / FARM_TICKET_USD);
  const tbill10 = FARM_TICKET_10K_USD * TBILL_RATE * (hold / 365);
  const net10 = round2(slice10Raw - fees - tbill10);
  return {
    ticket_usd: FARM_TICKET_USD,
    farm_days: hold,
    day_equivalents: dayEquivalents,
    slice_usd: slice,
    slice_snapshot_usd: round2(sliceSnapshotRaw),
    fees_usd: fees,
    tbill_usd: tbill,
    total_cost_usd: totalCost,
    hours: FARM_HOURS,
    net_usd: net,
    per_hour_usd: perHour,
    breakeven_odds: breakeven,
    pays_from_usd: paysFrom,
    verdict,
    slice_10k_usd: round2(slice10Raw),
    net_10k_usd: net10,
    per_hour_10k_usd: round2(net10 / FARM_HOURS),
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchanges whose products are not pre-token launches. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token and passing the watchlist's own
 * exclusion rule, so a wrapped, staked or bridged product never ranks as a launch that does not
 * exist yet. Every watchlist slug passes this rule by construction.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const ex of EXCHANGES) if (p.name.startsWith(ex)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, cal: Calibration = calibrate(snapshot), model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the watchlist rule keeps, below the floor.
  // No cap by TVL and no hand-picked names: the rule decides, the model ranks.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, cal, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    p25_usd: s.v.p25,
    p75_usd: s.v.p75,
    model: {
      multiple: round4(s.v.multiple),
      multiple_n: s.v.multipleN,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      family_effect: round4(s.v.familyEffect),
      age_days: s.v.age,
    },
    farm: farmEconomics(s.p, s.v.implied, s.v.age),
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in the words a farmer budgets by. */
export function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $3 to $8 of gas per transaction';
  if (chain === 'Solana') return 'under $0.05 of fees per transaction';
  if (chain === 'Bitcoin') return 'about $1 to $5 of network fees per transaction';
  if (chain === 'Tron') return 'about $1 to $3 of energy fees per transaction';
  if (['Arbitrum', 'Optimism', 'Base', 'Ink', 'Blast', 'Mode', 'Zora', 'Unichain', 'World Chain', 'Scroll', 'Linea', 'Polygon zkEVM', 'Mantle', 'Manta', 'Fraxtal', 'Abstract', 'Soneium', 'Berachain'].includes(chain)) return 'under $0.30 of gas per transaction';
  if (['Binance', 'Avalanche', 'Polygon', 'Gnosis', 'Fantom', 'Celo', 'Kava', 'Sei', 'Sui', 'Aptos', 'Near', 'Starknet', 'zkSync Era'].includes(chain)) return 'under $0.50 of gas per transaction';
  return 'under $1 of gas per transaction';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares in your wallet.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} in the pair it lists first, and keep the LP tokens.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it the same week.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL strategy on ${chain} and keep the receipt tokens.`;
  if (c.includes('derivative') || c.includes('perpetual')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it within a week.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the vault shares.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its most liquid market.`;
  if (c.includes('restak')) return `Restake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} through its official bridge, then use ${name}'s native app once.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC across ${name} to ${chain} and use the bridged funds in its app.`;
  if (c.includes('governance')) return `Stake $${capital} of the governance asset through ${name} and vote once while it is staked.`;
  if (c.includes('farm')) return `Stake $${capital} of LP tokens in ${name}'s farm on ${chain} and keep the position open.`;
  if (c.includes('otc')) return `Place one $${capital} order through ${name} and settle it on ${chain}.`;
  if (c.includes('payment')) return `Move $${capital} through ${name} on ${chain} and keep the receipt for the activity.`;
  if (c.includes('cedefi')) return `Deposit $${capital} with ${name} on ${chain} and keep the deposit receipt.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed range on ${chain} and keep the position.`;
  if (c.includes('anchor') || c.includes('decentralized btc')) return `Deposit $${capital} of BTC-backed value through ${name} on ${chain} and keep the receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** Compact dollars for a stop rule: $4.4M, $850K, $12,300. */
function compactMoney(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** Categories whose farm is a liquidity position, so impermanent loss is the stop rule. */
function isLiquidityPosition(p: SnapshotProtocol): boolean {
  const c = (p.category ?? '').toLowerCase();
  return c.includes('dex') || c.includes('liquidity manager') || c.includes('yield') || c.includes('leveraged farm') || c.includes('amm');
}

/**
 * A protocol's farm plan: eight steps, each an action with a WHEN, a cost and a time. The
 * plan is derived from the protocol's own record (category, chains, TVL, age), never from a
 * hand-written list of names. Step 6 is the stop rule: leave early if TVL falls below 80%
 * of today's TVL, or (for a liquidity position) if impermanent loss passes 2%. Step 7 is
 * the exit: past the hold, an extra day adds less to the slice than T-bills pay.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const stopTvl = compactMoney(p.tvl_usd * 0.8);
  const stopRule = isLiquidityPosition(p)
    ? `Leave early if ${p.name}'s TVL falls below ${stopTvl} or your impermanent loss passes 2%: withdraw, and do not re-enter on a bounce.`
    : `Leave early if ${p.name}'s TVL falls below ${stopTvl} or its points program ends: withdraw, and do not re-enter on a bounce.`;
  const tbillDay = Math.round(((capital * TBILL_RATE) / 365) * 100) / 100;
  return [
    {
      text: `Day 0 — Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas.replace('per transaction', 'for the first transaction'),
      time: '5 minutes',
    },
    {
      text: `Day 0 — ${action}`,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Each week — Repeat one qualifying action on ${chain}, such as a deposit, a swap, a vote or a claim, so the wallet stays active.`,
      cost: gas.replace('per transaction', 'a week'),
      time: '10 minutes a week',
    },
    {
      text: `Days 1–${hold} — Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Day ${Math.ceil(hold / 2)} — Open ${p.name}'s own points or rewards page in its app and check your balance; claim only from the link the app itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Any day — ${stopRule}`,
      cost: gas.replace('per transaction', 'to unwind'),
      time: '10 minutes to check',
    },
    {
      text: `Day ${hold} — Withdraw the position and revoke the approval. Past day ${hold}, an extra day adds less to the slice than the $${tbillDay} a day T-bills pay on the $${capital}.`,
      cost: gas.replace('per transaction', 'to unwind'),
      time: '15 minutes to exit',
    },
    {
      text: `Day 0 and ongoing — Keep this farm under 10% of your farm bankroll: never deposit funds you need back this month, never borrow against the position, and write the wallet, the dates and every transaction hash in a farm log.`,
      cost: 'nothing but discipline',
      time: '5 minutes to size it',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      fdv_tvl: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 100) / 100 : null,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, rankRange?: { rank_min: number; rank_max: number; top20_share: number }): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    p25_usd: row.p25_usd,
    p75_usd: row.p75_usd,
    multiple: row.model.multiple,
    family_effect: row.model.family_effect,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm: row.farm,
    farm_steps: farmSteps(
      {
        slug: row.slug,
        name: row.name,
        category: row.category,
        chains: row.chains,
        tvl_usd: row.tvl_usd,
        change_7d: row.change_7d,
        mcap_usd: row.mcap_usd,
        listed_at: row.listed_at,
        gecko_id: row.gecko_id,
        symbol: row.symbol,
      },
      row.age_days,
    ),
    rank_min: rankRange?.rank_min ?? row.rank,
    rank_max: rankRange?.rank_max ?? row.rank,
    top20_share: rankRange?.top20_share ?? (row.rank <= 20 ? 1 : 0),
    watchlist: row.watchlist,
  };
}

/** Ranks with ties averaged, for the Spearman correlation. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const r = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k]![1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Pearson correlation of two equal-length series. */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** One method's out-of-sample scores on a test set. */
function validationMetrics(actual: number[], predicted: number[]): ValidationMetrics {
  const misses = actual.map((a, i) => Math.max(predicted[i]!, a) / Math.min(predicted[i]!, a)).sort((a, b) => a - b);
  const within = (x: number): number => misses.filter((m) => m <= x).length;
  return {
    n: actual.length,
    median_miss: round2(median(misses)),
    within_2x_pct: actual.length === 0 ? 0 : round2((within(2) / actual.length) * 100),
    within_3x_pct: actual.length === 0 ? 0 : round2((within(3) / actual.length) * 100),
    spearman: round2(pearson(ranks(predicted), ranks(actual))),
  };
}

/** The flat overall median multiple, fitted on `train`, applied to `test`. */
function flatMultiplePredictions(train: SnapshotProtocol[], test: SnapshotProtocol[]): number[] {
  const ms = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const med = median(ms);
  return test.map((p) => p.tvl_usd * med);
}

/**
 * The radar-2 baseline: a flat category multiple, the category median shrunk toward the
 * overall median (full weight at 5+ comps, 0.6 at 3+, 0.4 at 1+, none below), clamped [0.05, 2].
 */
function categoryMultiplePredictions(train: SnapshotProtocol[], test: SnapshotProtocol[]): number[] {
  const all = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const overall = median(all);
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCat.set(key, list);
  }
  return test.map((p) => {
    const rs = (byCat.get(p.category ?? 'Other') ?? []).slice().sort((a, b) => a - b);
    const med = rs.length > 0 ? median(rs) : null;
    const w = rs.length >= 5 ? 1 : rs.length >= 3 ? 0.6 : rs.length >= 1 ? 0.4 : 0;
    const raw = med === null ? overall : w * med + (1 - w) * overall;
    return p.tvl_usd * Math.min(2, Math.max(0.05, raw));
  });
}

/** The curve, fitted on `train`, applied to `test` (curve value only, no growth or age). */
function curvePredictions(train: SnapshotProtocol[], test: SnapshotProtocol[]): number[] {
  const fit = fitCurve(train);
  return test.map((p) => curveValue(fit, p));
}

/** Curve vs both baselines on one test set, all predicting the anchors' actual market caps. */
function compareOn(train: SnapshotProtocol[], test: SnapshotProtocol[]): ValidationComparison {
  const actual = test.map((p) => p.mcap_usd!);
  return {
    curve: validationMetrics(actual, curvePredictions(train, test)),
    flat_multiple: validationMetrics(actual, flatMultiplePredictions(train, test)),
    category_multiple: validationMetrics(actual, categoryMultiplePredictions(train, test)),
  };
}

/**
 * Out-of-sample validation, computed at build time from the snapshot alone.
 * Leave-one-out refits the curve (and its family effects) without each anchor and predicts it;
 * the time split fits on listings before 2025-01-01 and tests on listings from 2025 on.
 * Both baselines run on the same folds, so the table honestly shows whether the curve beats
 * the flat multiples out of sample.
 */
export function validate(snapshot: Snapshot): Validation {
  const anchors = tradedAnchors(snapshot);
  // Leave-one-out: one fold per anchor.
  const looActual: number[] = [];
  const looCurve: number[] = [];
  const looFlat: number[] = [];
  const looCat: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const train = anchors.filter((_, j) => j !== i);
    const test = [anchors[i]!];
    looActual.push(test[0]!.mcap_usd!);
    looCurve.push(curvePredictions(train, test)[0]!);
    looFlat.push(flatMultiplePredictions(train, test)[0]!);
    looCat.push(categoryMultiplePredictions(train, test)[0]!);
  }
  const dated = anchors.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! < '2025-01-01');
  const test = dated.filter((p) => p.listed_at! >= '2025-01-01');
  return {
    anchors: anchors.length,
    loo: {
      n: anchors.length,
      curve: validationMetrics(looActual, looCurve),
      flat_multiple: validationMetrics(looActual, looFlat),
      category_multiple: validationMetrics(looActual, looCat),
    },
    time_split: { split: 'listed_at < 2025-01-01 vs >= 2025-01-01', train_n: train.length, test_n: test.length, ...compareOn(train, test) },
  };
}

/** Deterministic RNG (mulberry32): every bootstrap and refit below replays exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Solve A x = b by Gaussian elimination with partial pivoting; null when singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]) > Math.abs(m[pivot]![col])) pivot = r;
    if (Math.abs(m[pivot]![col]) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col] / m[col]![col];
      for (let c = col; c <= n; c++) m[r]![c] -= f * m[col]![c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r]![n]!;
    for (let c = r + 1; c < n; c++) s -= m[r]![c] * x[c]!;
    x[r] = s / m[r]![r];
  }
  return x;
}

/** One method's out-of-sample scores on finite actual/predicted pairs (Spearman to 3 decimals). */
function metrics3(actual: number[], predicted: number[]): ValidationMetrics3 {
  const pairs = actual.map((a, i) => [a, predicted[i]!] as const).filter(([a, p]) => Number.isFinite(a) && Number.isFinite(p) && a > 0 && p > 0);
  const misses = pairs.map(([a, p]) => Math.max(a, p) / Math.min(a, p)).sort((a, b) => a - b);
  const within = (x: number): number => misses.filter((m) => m <= x).length;
  return {
    n: pairs.length,
    median_miss: round2(median(misses)),
    within_2x_pct: pairs.length === 0 ? 0 : round2((within(2) / pairs.length) * 100),
    within_3x_pct: pairs.length === 0 ? 0 : round2((within(3) / pairs.length) * 100),
    spearman: round3(pearson(ranks(pairs.map(([, p]) => p)), ranks(pairs.map(([a]) => a)))),
  };
}

/** Miss ratios for finite pairs, aligned with `actual` (NaN where the prediction is missing). */
function missList(actual: number[], predicted: number[]): number[] {
  return actual.map((a, i) => {
    const p = predicted[i]!;
    return Number.isFinite(p) && a > 0 && p > 0 ? Math.max(a, p) / Math.min(a, p) : NaN;
  });
}

/**
 * Paired-bootstrap standard error of the difference of two median misses (2000 draws,
 * seed 1): resample the paired test items, take the median miss of each arm on the
 * resample, and report the standard deviation of the differences.
 */
function pairedBootstrapSE(missA: number[], missB: number[], draws = 2000, seed = 1): number {
  const pairs = missA.map((a, i) => [a, missB[i]!] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pairs.length === 0) return 0;
  const rng = mulberry32(seed);
  const diffs: number[] = [];
  for (let d = 0; d < draws; d++) {
    const sa: number[] = [];
    const sb: number[] = [];
    for (let k = 0; k < pairs.length; k++) {
      const pick = pairs[Math.floor(rng() * pairs.length)]!;
      sa.push(pick[0]);
      sb.push(pick[1]);
    }
    diffs.push(median(sa.sort((a, b) => a - b)) - median(sb.sort((a, b) => a - b)));
  }
  const mean = diffs.reduce((s, x) => s + x, 0) / diffs.length;
  return Math.sqrt(diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / diffs.length);
}

/** A prediction variant: how a train set scores a test set. */
type VariantName =
  | 'flat'
  | 'huber'
  | 'huberCat'
  | 'huberCatK8'
  | 'cap1M'
  | 'multi'
  | 'multiGrowth'
  | 'ridge20'
  | 'rank'
  | 'board'
  | 'boardNoGrowth'
  | 'boardNoClock'
  | 'boardNoFamily';

/** The multivariate features: logTVL, 7d growth as a fraction, capped age as a fraction of 730d. */
function multiFeatures(p: SnapshotProtocol, asOf: string): [number, number, number] {
  const age = ageDays(asOf, p.listed_at);
  return [Math.log10(p.tvl_usd), (p.change_7d ?? 0) / 100, Math.min(age ?? 365, 730) / 730];
}

/** OLS on a chosen subset of the multivariate features; null only when the system stays singular. */
function multiFit(train: SnapshotProtocol[], asOf: string, cols: number[]): number[] | null {
  const rows = train.map((p) => {
    const f = multiFeatures(p, asOf);
    return [1, ...cols.map((c) => f[c]!)];
  });
  const y = train.map((p) => Math.log10(p.mcap_usd!));
  const k = rows[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += rows[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += rows[i]![a]! * rows[i]![b]!;
    }
  }
  const solved = solveLinear(xtx, xty);
  if (solved !== null) return solved;
  // Degenerate design (the time-split train cohort is all ≥733 days old, so the capped-age
  // feature is constant 1.0 and collinear with the intercept): a 1e-8 ridge lets the system
  // solve, and the split between intercept and age is then arbitrary — which is exactly
  // why the variant blows up out of sample. The fallback exists so the blowup is measured,
  // not hidden behind a missing value.
  for (let a = 0; a < k; a++) xtx[a]![a]! += 1e-8;
  return solveLinear(xtx, xty);
}

/** Ridge on [logTVL, growth, age] with penalty 20 on the growth/age coefficients only. */
function ridgeFit(train: SnapshotProtocol[], asOf: string): number[] | null {
  const rows = train.map((p) => [1, ...multiFeatures(p, asOf)]);
  const y = train.map((p) => Math.log10(p.mcap_usd!));
  const k = 4;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += rows[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += rows[i]![a]! * rows[i]![b]!;
    }
  }
  xtx[2]![2]! += 20;
  xtx[3]![3]! += 20;
  return solveLinear(xtx, xty);
}

/**
 * One variant's predictions for `test`, fitted on `train`. NaN where the variant cannot
 * score (the cap≤$1M variant needs at least 5 small comps; a singular multivariate fit).
 */
function variantPredictions(variant: VariantName, train: SnapshotProtocol[], test: SnapshotProtocol[], asOf: string): number[] {
  if (variant === 'flat') {
    if (train.length === 0) return test.map(() => NaN);
    const med = median(train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b));
    return test.map((p) => p.tvl_usd * med);
  }
  if (variant === 'cap1M') {
    const small = train.filter((p) => p.mcap_usd! <= 1_000_000);
    if (small.length < 5) return test.map(() => NaN);
    return variantPredictions('huberCat', small, test, asOf);
  }
  if (variant === 'multi' || variant === 'multiGrowth') {
    const cols = variant === 'multi' ? [0, 1, 2] : [0, 1];
    const beta = multiFit(train, asOf, cols);
    if (beta === null) return test.map(() => NaN);
    return test.map((p) => {
      const f = multiFeatures(p, asOf);
      return 10 ** (beta[0]! + cols.reduce((s, c, i) => s + beta[i + 1]! * f[c]!, 0));
    });
  }
  if (variant === 'ridge20') {
    const beta = ridgeFit(train, asOf);
    if (beta === null) return test.map(() => NaN);
    return test.map((p) => {
      const f = multiFeatures(p, asOf);
      return 10 ** (beta[0]! + beta[1]! * f[0]! + beta[2]! * f[1]! + beta[3]! * f[2]!);
    });
  }
  if (variant === 'rank') {
    // Rank regression: OLS of rank(mcap) on rank(TVL), mapped back through the train
    // market caps by linear interpolation on the predicted rank.
    const xs = train.map((p) => Math.log10(p.tvl_usd));
    const ys = train.map((p) => Math.log10(p.mcap_usd!));
    const [a, b] = wls2(ranks(xs), ranks(ys), xs.map(() => 1));
    const sortedMcap = train.map((p) => p.mcap_usd!).sort((x, y) => x - y);
    return test.map((p) => {
      const below = xs.filter((x) => x < Math.log10(p.tvl_usd)).length;
      const rankPred = Math.min(Math.max(a + b * (below + 1), 1), train.length);
      const pos = rankPred - 1;
      const lo = Math.floor(pos);
      const hi = Math.min(lo + 1, train.length - 1);
      const frac = pos - lo;
      return sortedMcap[lo]! * (1 - frac) + sortedMcap[hi]! * frac;
    });
  }
  const fit = fitCurve(train, variant === 'huberCatK8' ? 8 : EFFECT_PSEUDO_COUNT, EFFECT_MIN_N);
  const withCat = variant === 'huberCat' || variant === 'huberCatK8' || variant === 'cap1M' || variant === 'board' || variant === 'boardNoGrowth' || variant === 'boardNoClock';
  return test.map((p) => {
    const base = withCat ? curveValue(fit, p) : 10 ** (fit.intercept + fit.slope * Math.log10(p.tvl_usd));
    if (variant === 'huber' || variant === 'huberCat' || variant === 'huberCatK8' || variant === 'cap1M') return base;
    const age = ageDays(asOf, p.listed_at);
    const g = growthMultiplier(p);
    const m = maturityMultiplier(age);
    if (variant === 'board') return base * g * m;
    if (variant === 'boardNoGrowth') return base * m;
    if (variant === 'boardNoClock') return base * g;
    return base * g * m; // boardNoFamily: huber curve (no cat) x growth x maturity
  });
}

/** Leave-one-out predictions for one variant, aligned with `anchors`. */
function looPredictions(variant: VariantName, anchors: SnapshotProtocol[], asOf: string): { actual: number[]; predicted: number[] } {
  const actual: number[] = [];
  const predicted: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const train = anchors.filter((_, j) => j !== i);
    actual.push(anchors[i]!.mcap_usd!);
    predicted.push(variantPredictions(variant, train, [anchors[i]!], asOf)[0]!);
  }
  return { actual, predicted };
}

/** Time-split predictions for one variant: fit before 2025-01-01, test on listings from 2025 on. */
function timeSplitPredictions(variant: VariantName, anchors: SnapshotProtocol[], asOf: string): { actual: number[]; predicted: number[] } {
  const dated = anchors.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! < '2025-01-01');
  const test = dated.filter((p) => p.listed_at! >= '2025-01-01');
  return { actual: test.map((p) => p.mcap_usd!), predicted: variantPredictions(variant, train, test, asOf) };
}

/** Walk-forward predictions for one variant: 5 origins by listed_at, pooled over the origins. */
function walkForwardPredictions(
  variant: VariantName,
  dated: SnapshotProtocol[],
  asOf: string,
): { origins: { fraction: number; train_n: number; test_n: number; metrics: ValidationMetrics3 }[]; pooled: ValidationMetrics3; pooledMiss: number[] } {
  const origins = [];
  const pooledActual: number[] = [];
  const pooledPredicted: number[] = [];
  for (const fraction of [0.5, 0.6, 0.7, 0.8, 0.9]) {
    const nTrain = Math.floor(fraction * dated.length);
    const train = dated.slice(0, nTrain);
    const test = dated.slice(nTrain);
    const predicted = variantPredictions(variant, train, test, asOf);
    const actual = test.map((p) => p.mcap_usd!);
    pooledActual.push(...actual);
    pooledPredicted.push(...predicted);
    origins.push({ fraction, train_n: train.length, test_n: test.length, metrics: metrics3(actual, predicted) });
  }
  return { origins, pooled: metrics3(pooledActual, pooledPredicted), pooledMiss: missList(pooledActual, pooledPredicted) };
}

/**
 * Walk-forward validation, computed at build time. The curve and flat series score the
 * fitted curve only (the same predictions as LOO); the board series scores the shipped
 * board formula (curve x growth x maturity) on the same origins.
 */
export function walkForward(snapshot: Snapshot): WalkForward {
  const anchors = tradedAnchors(snapshot);
  const dated = anchors
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const curve = walkForwardPredictions('huberCat', dated, snapshot.as_of);
  const flat = walkForwardPredictions('flat', dated, snapshot.as_of);
  const board = walkForwardPredictions('board', dated, snapshot.as_of);
  return {
    origins: curve.origins.map((o, i) => ({
      fraction: o.fraction,
      train_n: o.train_n,
      test_n: o.test_n,
      curve: o.metrics,
      flat_multiple: flat.origins[i]!.metrics,
      board: board.origins[i]!.metrics,
    })),
    overall_curve: curve.pooled,
    overall_flat: flat.pooled,
    overall_board: board.pooled,
    note: 'Origins are fractions of the 80 dated anchors by listed_at; each origin trains on the first fraction and tests the rest. Overall pools all 120 origin tests. Curve and flat score the fitted curve only (same basis as LOO); board scores the shipped formula, curve x growth x maturity.',
  };
}

/**
 * The ablation table: flat → + size curve (Huber) → + category effects, each rung scored
 * by LOO and walk-forward on the same curve-only predictions, plus the rejected tries.
 * Keep rule (stated verbatim): "lower LOO miss, walk-forward miss up by at most one
 * paired-bootstrap SE." The category rung ties the curve rung on LOO miss (3.18x vs
 * 3.18x, difference 0.00, SE 0.30) — it does not meet the rule's first clause on LOO
 * alone, and the table says so; it is kept because walk-forward miss falls and
 * time-split Spearman rises (0.254 → 0.294).
 */
export function ablation(snapshot: Snapshot): Ablation {
  const anchors = tradedAnchors(snapshot);
  const asOf = snapshot.as_of;
  const dated = anchors
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const loo = (v: VariantName) => {
    const { actual, predicted } = looPredictions(v, anchors, asOf);
    return { metrics: metrics3(actual, predicted), miss: missList(actual, predicted) };
  };
  const wf = (v: VariantName) => walkForwardPredictions(v, dated, asOf).pooled;
  const ts = (v: VariantName) => {
    const { actual, predicted } = timeSplitPredictions(v, anchors, asOf);
    return metrics3(actual, predicted);
  };
  const flatLoo = loo('flat');
  const huberLoo = loo('huber');
  const catLoo = loo('huberCat');
  const flatWf = wf('flat');
  const huberWf = wf('huber');
  const catWf = wf('huberCat');
  const seHuber = pairedBootstrapSE(huberLoo.miss, flatLoo.miss);
  const seCat = pairedBootstrapSE(catLoo.miss, huberLoo.miss);
  const catTs = ts('huberCat');
  const huberTs = ts('huber');
  const rungs: AblationRung[] = [
    {
      name: 'flat',
      basis: 'curve-only: overall median mcap/TVL multiple',
      loo_miss: flatLoo.metrics.median_miss,
      loo_within_3x_pct: flatLoo.metrics.within_3x_pct,
      loo_spearman: flatLoo.metrics.spearman,
      wf_miss: flatWf.median_miss,
      wf_within_3x_pct: flatWf.within_3x_pct,
      delta_loo: 0,
      delta_wf: 0,
      se: 0,
      compared_to: '—',
      rule: 'BASELINE',
      rule_detail: 'Baseline: no fit, so no leverage loss on rank — the Spearman to beat, not a model.',
    },
    {
      name: '+ size curve (Huber)',
      basis: 'curve-only: Huber IRLS c=1.345, no category effects',
      loo_miss: huberLoo.metrics.median_miss,
      loo_within_3x_pct: huberLoo.metrics.within_3x_pct,
      loo_spearman: huberLoo.metrics.spearman,
      wf_miss: huberWf.median_miss,
      wf_within_3x_pct: huberWf.within_3x_pct,
      delta_loo: round2(huberLoo.metrics.median_miss - flatLoo.metrics.median_miss),
      delta_wf: round2(huberWf.median_miss - flatWf.median_miss),
      se: round3(seHuber),
      compared_to: 'flat',
      rule: 'KEPT',
      rule_detail: `LOO miss falls ${flatLoo.metrics.median_miss}x → ${huberLoo.metrics.median_miss}x and walk-forward miss falls ${flatWf.median_miss}x → ${huberWf.median_miss}x: meets the keep rule.`,
    },
    {
      name: '+ category effects',
      basis: 'curve-only: Huber + median-residual effects, k=12, min_n=3 (final model)',
      loo_miss: catLoo.metrics.median_miss,
      loo_within_3x_pct: catLoo.metrics.within_3x_pct,
      loo_spearman: catLoo.metrics.spearman,
      wf_miss: catWf.median_miss,
      wf_within_3x_pct: catWf.within_3x_pct,
      delta_loo: round2(catLoo.metrics.median_miss - huberLoo.metrics.median_miss),
      delta_wf: round2(catWf.median_miss - huberWf.median_miss),
      se: round3(seCat),
      compared_to: '+ size curve (Huber)',
      rule: 'KEPT',
      rule_detail: `LOO miss ties the curve rung (${huberLoo.metrics.median_miss}x vs ${catLoo.metrics.median_miss}x, Δ 0.00, SE ${round3(seCat)}) — NOT lower, so it fails the keep rule's first clause on LOO alone; kept because walk-forward miss falls ${huberWf.median_miss}x → ${catWf.median_miss}x and time-split Spearman rises ${huberTs.spearman} → ${catTs.spearman}.`,
    },
  ];
  const boardLoo = loo('board');
  const boardWf = wf('board');
  const boardTs = ts('board');
  const rejectedSpec: { name: string; variant: VariantName; basis: string; reason: (m: { loo: ValidationMetrics3; wf: ValidationMetrics3; ts: ValidationMetrics3 }) => string }[] = [
    {
      name: 'multivariate growth/age',
      variant: 'multi',
      basis: 'curve-only: OLS logTVL + growth + age (cap 730d, unknown 365d)',
      reason: (m) => `Time-split miss ${m.ts.median_miss}x, Spearman ${m.ts.spearman}: growth and age do not generalise to 2025+ listings — the fitted coefficients flip sign between cohorts.`,
    },
    {
      name: 'ridge (λ=20) on growth/age',
      variant: 'ridge20',
      basis: 'curve-only: ridge penalty 20 on growth/age coefficients, intercept+slope unpenalised',
      reason: (m) => `Time-split Spearman ${m.ts.spearman} vs 0.294 final, LOO miss ${m.loo.median_miss}x vs 3.18x final: shrinkage tames the blowup but still ranks worse out of sample.`,
    },
    {
      name: 'rank regression',
      variant: 'rank',
      basis: 'curve-only: OLS of rank(mcap) on rank(TVL), mapped back through train market caps',
      reason: (m) => `LOO miss ${m.loo.median_miss}x vs 3.18x final, time-split Spearman ${m.ts.spearman}: rank space buys nothing on miss and loses on the time split.`,
    },
    {
      name: 'family shrink K=8',
      variant: 'huberCatK8',
      basis: 'curve-only: Huber + category effects shrunk with k=8 instead of 12',
      reason: (m) => `LOO miss ${m.loo.median_miss}x vs 3.18x at k=12: weaker shrinkage lets thin categories move the curve more than the data supports.`,
    },
    {
      name: 'cap ≤ $1M comps',
      variant: 'cap1M',
      basis: 'curve-only: Huber + category effects fitted on the 15 comps with mcap ≤ $1M only',
      reason: (m) => `LOO miss ${m.loo.median_miss}x, time-split ${m.ts.median_miss}x: small comps do not price the board — the fit extrapolates wildly to large TVLs.`,
    },
    {
      name: 'growth fitted slope',
      variant: 'multiGrowth',
      basis: 'curve-only: OLS logTVL + fitted 7d-growth slope (no age)',
      reason: (m) => `LOO Spearman ${m.loo.spearman} vs 0.338 final, time-split Spearman ${m.ts.spearman}: the 7d change carries no rank signal out of sample, even though LOO miss (${m.loo.median_miss}x) is marginally lower.`,
    },
    {
      name: 'growth off',
      variant: 'boardNoGrowth',
      basis: 'board-formula: final curve x maturity, no growth multiplier',
      reason: (m) =>
        `Board formula without growth: LOO ${m.loo.median_miss}x, WF ${m.wf.median_miss}x, TS ${m.ts.median_miss}x vs final board ${boardLoo.metrics.median_miss}x / ${boardWf.median_miss}x / ${boardTs.median_miss}x — ${m.loo.median_miss <= boardLoo.metrics.median_miss ? 'no worse on LOO, but the growth term is a stated board assumption carried from radar-3, not a fitted regressor' : 'worse on LOO'}.`,
    },
    {
      name: 'family off',
      variant: 'boardNoFamily',
      basis: 'board-formula: Huber curve (no category effects) x growth x maturity',
      reason: (m) =>
        `Board formula without family effects: LOO ${m.loo.median_miss}x, WF ${m.wf.median_miss}x, TS Spearman ${m.ts.spearman} vs final board ${boardLoo.metrics.median_miss}x / ${boardWf.median_miss}x / ${boardTs.spearman} — ${m.loo.median_miss < boardLoo.metrics.median_miss ? 'better on LOO miss, but the curve-only validation (the candidate-A definition) ties on LOO and the effects win the time split on rank, so they stay' : 'worse on LOO'}.`,
    },
    {
      name: 'clock off',
      variant: 'boardNoClock',
      basis: 'board-formula: final curve x growth, no maturity multiplier',
      reason: (m) =>
        `Board formula without the maturity clock: LOO ${m.loo.median_miss}x, WF ${m.wf.median_miss}x, TS ${m.ts.median_miss}x vs final board ${boardLoo.metrics.median_miss}x / ${boardWf.median_miss}x / ${boardTs.median_miss}x — ${m.loo.median_miss <= boardLoo.metrics.median_miss ? 'no worse on LOO, but the clock is a stated board assumption carried from radar-3, not a fitted regressor' : 'worse on LOO'}.`,
    },
  ];
  const rejected: AblationRejected[] = rejectedSpec.map((spec) => {
    const l = loo(spec.variant);
    const w = wf(spec.variant);
    const t = ts(spec.variant);
    const se = pairedBootstrapSE(l.miss, catLoo.miss);
    return {
      name: spec.name,
      basis: spec.basis,
      loo_n: l.metrics.n,
      loo_miss: l.metrics.n > 0 ? l.metrics.median_miss : null,
      loo_within_3x_pct: l.metrics.n > 0 ? l.metrics.within_3x_pct : null,
      loo_spearman: l.metrics.n > 0 ? l.metrics.spearman : null,
      wf_n: w.n,
      wf_miss: w.n > 0 ? w.median_miss : null,
      ts_n: t.n,
      ts_miss: t.n > 0 ? t.median_miss : null,
      ts_spearman: t.n > 0 ? t.spearman : null,
      se: l.metrics.n > 0 ? round3(se) : null,
      compared_to: '+ category effects',
      rule: 'REJECTED',
      reason: spec.reason({ loo: l.metrics, wf: w, ts: t }),
    };
  });
  return {
    keep_rule: 'lower LOO miss, walk-forward miss up by at most one paired-bootstrap SE',
    rungs,
    rejected,
  };
}

/**
 * Rank ranges from 200 bootstrap refits of the curve (seed 7): each refit resamples the
 * anchors with replacement, refits Huber + category effects, and re-ranks the board with
 * the shipped formula. Returns the per-row range and top-20 share, keyed by slug.
 */
export function rankRanges(
  snapshot: Snapshot,
  board: BoardRow[],
  cal: Calibration = calibrate(snapshot),
): { bySlug: Map<string, { rank_min: number; rank_max: number; top20_share: number }>; summary: RankRanges } {
  const anchors = tradedAnchors(snapshot);
  const rng = mulberry32(7);
  const bySlugProto = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const stats = new Map<string, { min: number; max: number; top20: number }>();
  for (const row of board) stats.set(row.slug, { min: Infinity, max: -Infinity, top20: 0 });
  const REFITS = 200;
  for (let r = 0; r < REFITS; r++) {
    const sample: SnapshotProtocol[] = [];
    for (let k = 0; k < anchors.length; k++) sample.push(anchors[Math.floor(rng() * anchors.length)]!);
    const refCal = calibrationFromCurve(snapshot, fitCurve(sample));
    const scored = board
      .map((row) => ({ slug: row.slug, implied: impliedValue(bySlugProto.get(row.slug)!, snapshot.as_of, refCal).implied }))
      .sort((a, b) => b.implied - a.implied || (a.slug < b.slug ? -1 : 1));
    scored.forEach((s, i) => {
      const st = stats.get(s.slug)!;
      const rank = i + 1;
      if (rank < st.min) st.min = rank;
      if (rank > st.max) st.max = rank;
      if (rank <= 20) st.top20++;
    });
  }
  const bySlug = new Map<string, { rank_min: number; rank_max: number; top20_share: number }>();
  for (const [slug, st] of stats) {
    bySlug.set(slug, { rank_min: st.min, rank_max: st.max, top20_share: round3(st.top20 / REFITS) });
  }
  const top20Stable = board.slice(0, 20).filter((row) => (bySlug.get(row.slug)?.top20_share ?? 0) >= 0.8).length;
  return {
    bySlug,
    summary: {
      refits: REFITS,
      seed: 7,
      top20_stable: top20Stable,
      top20_total: 20,
      summary: `${top20Stable} of top 20 stay top 20 in ≥80% of 200 refits`,
    },
  };
}

/**
 * Bands-hold calibration: on leave-one-out predictions, the share of actual market caps
 * inside the P25–P75 band (aim 50%) and the P10–P90 band (aim 80%), each band built from
 * the fold's own residual dispersion.
 */
export function bandsHold(snapshot: Snapshot): BandsHold {
  const anchors = tradedAnchors(snapshot);
  let in50 = 0;
  let in90 = 0;
  for (let i = 0; i < anchors.length; i++) {
    const train = anchors.filter((_, j) => j !== i);
    const fit = fitCurve(train);
    const pred = curveValue(fit, anchors[i]!);
    const actual = anchors[i]!.mcap_usd!;
    const f50 = 10 ** (0.6745 * fit.residual_std);
    const f90 = 10 ** (1.2816 * fit.residual_std);
    if (pred / f50 <= actual && actual <= pred * f50) in50++;
    if (pred / f90 <= actual && actual <= pred * f90) in90++;
  }
  return {
    n: anchors.length,
    p25_p75_pct: round2((in50 / anchors.length) * 100),
    p10_p90_pct: round2((in90 / anchors.length) * 100),
    aim_p25_p75: 50,
    aim_p10_p90: 80,
    basis: 'Leave-one-out predictions, band from each fold’s own residual dispersion.',
  };
}

/** Rows whose board rank is 5+ ranks off their pure TVL-order rank. */
export function notTvlAlone(board: BoardRow[]): NotTvlAlone {
  const byTvl = [...board].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const tvlRank = new Map(byTvl.map((r, i) => [r.slug, i + 1]));
  const count = board.filter((r) => Math.abs(r.rank - (tvlRank.get(r.slug) ?? 0)) >= 5).length;
  return { count, total: board.length, text: `${count} of ${board.length} rows 5+ ranks off TVL order` };
}

/** The set-aside reason for a pre-token protocol the board does not rank, by first matching rule. */
function setAsideReason(p: SnapshotProtocol): SetAsideRow['reason'] {
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'liquid_staking';
  if (p.category === 'CEX' || EXCHANGES.some((ex) => p.name.startsWith(ex))) return 'exchange_custody';
  if (VERSIONED.test(p.name)) return 'versioned_listing';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped_staked';
  return 'kin_of_token';
}

/**
 * The 758-protocol ledger: ranked (198) + token trades (128) + token on record (288) +
 * set aside (144) = 758. Set-aside reasons follow the same rule order as the board's
 * exclusion rule; kin_of_token is the fallback and is 0 in this snapshot.
 */
export function ledger(snapshot: Snapshot): { ledger: Ledger; traded: TradedRow[]; on_record: OnRecordRow[]; set_aside: SetAsideRow[] } {
  const counts = { bridge: 0, liquid_staking: 0, exchange_custody: 0, versioned_listing: 0, wrapped_staked: 0, kin_of_token: 0 };
  const traded: TradedRow[] = [];
  const onRecord: OnRecordRow[] = [];
  const setAside: SetAsideRow[] = [];
  let ranked = 0;
  for (const p of snapshot.protocols) {
    if (isRankable(p)) {
      ranked++;
    } else if (!isPreToken(p)) {
      if (p.mcap_usd !== null && p.mcap_usd > 0) {
        traded.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d });
      } else {
        onRecord.push({ slug: p.slug, name: p.name, category: p.category, gecko_id: p.gecko_id, symbol: p.symbol });
      }
    } else {
      const reason = setAsideReason(p);
      counts[reason]++;
      setAside.push({ slug: p.slug, name: p.name, category: p.category, reason });
    }
  }
  traded.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  const setAsideTotal = Object.values(counts).reduce((s, n) => s + n, 0);
  return {
    ledger: {
      total: snapshot.protocols.length,
      ranked,
      token_trades: traded.length,
      token_on_record: onRecord.length,
      set_aside_total: setAsideTotal,
      set_aside: counts,
    },
    traded,
    on_record: onRecord,
    set_aside: setAside,
  };
}

/** The best farms now, ranked by net on a $10,000 ticket. */
export function bestFarms(board: BoardRow[]): BestFarm[] {
  return [...board]
    .sort((a, b) => b.farm.net_10k_usd - a.farm.net_10k_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 3)
    .map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      ticket_usd: FARM_TICKET_10K_USD,
      slice_usd: r.farm.slice_10k_usd,
      fees_usd: r.farm.fees_usd,
      tbill_usd: round2(FARM_TICKET_10K_USD * TBILL_RATE * (r.farm.farm_days / 365)),
      hours: r.farm.hours,
      days: r.farm.farm_days,
      net_usd: r.farm.net_10k_usd,
      per_hour_usd: r.farm.per_hour_10k_usd,
    }));
}

/** Farming every FARM + THIN row at the $1,000 ticket, summed. */
export function portfolio(board: BoardRow[]): Portfolio {
  const rows = board.filter((r) => r.farm.verdict === 'FARM' || r.farm.verdict === 'THIN');
  return {
    ticket_usd: FARM_TICKET_USD,
    farm_count: board.filter((r) => r.farm.verdict === 'FARM').length,
    thin_count: board.filter((r) => r.farm.verdict === 'THIN').length,
    farm_thin_count: rows.length,
    costs_usd: round2(rows.reduce((s, r) => s + r.farm.total_cost_usd, 0)),
    net_usd: round2(rows.reduce((s, r) => s + r.farm.net_usd, 0)),
    hours: round2(rows.reduce((s, r) => s + r.farm.hours, 0)),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, cal: Calibration = calibrate(snapshot), model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, cal, model);
  const live = liveRows(snapshot);
  const anchors = tradedAnchors(snapshot).map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }));
  const early = board.filter((r) => !r.watchlist).length;
  const calibration: CalibrationRow[] = [...cal.byCategory.entries()]
    .filter(([, v]) => v.n > 0)
    .map(([category, v]) => ({
      category,
      comparables: v.n,
      median_residual: v.median_residual === null ? null : round4(v.median_residual),
      effect: round4(v.effect),
      effect_multiplier: round4(10 ** v.effect),
    }))
    .sort((a, b) => b.effect - a.effect || (a.category < b.category ? -1 : 1));
  const curve = cal.curve;
  const validation = validate(snapshot);
  const wf = walkForward(snapshot);
  const abl = ablation(snapshot);
  const ranges = rankRanges(snapshot, board, cal);
  const holds = bandsHold(snapshot);
  const notTvl = notTvlAlone(board);
  const led = ledger(snapshot);
  const best = bestFarms(board);
  const port = portfolio(board);
  const impliedTotal = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const bestPerHour = Math.max(...board.map((r) => r.farm.per_hour_usd));
  const bestPerHour10k = Math.max(...board.map((r) => r.farm.per_hour_10k_usd));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    calibration,
    overall_multiple: round4(cal.overall),
    curve: {
      anchors: curve.anchors,
      intercept: round4(curve.intercept),
      slope: round4(curve.slope),
      // Full precision, not round4: the dashboard's band() recomputes p25/p75 from this
      // value, and rounding it to 4 decimals moves the top rows' p75 by up to ~$10k.
      residual_std: curve.residual_std,
      r_squared: round4(curve.r_squared),
    },
    validation,
    walk_forward: wf,
    ablation: abl,
    rank_ranges: ranges.summary,
    bands_hold: holds,
    not_tvl_alone: notTvl,
    ledger: led.ledger,
    traded: led.traded,
    on_record: led.on_record,
    set_aside: led.set_aside,
    best_farms: best,
    portfolio: port,
    kpis: {
      ranked: board.length,
      implied_total_usd: impliedTotal,
      loo_miss: validation.loo.curve.median_miss,
      ts_miss: validation.time_split.curve.median_miss,
      wf_miss: wf.overall_curve.median_miss,
      range_holds_p25_p75_pct: holds.p25_p75_pct,
      worth_farming: board.filter((r) => r.farm.verdict === 'FARM').length,
      best_per_hour_usd: round2(bestPerHour),
      best_per_hour_10k_usd: round2(bestPerHour10k),
    },
    rows: board.map((row) => radarRow(row, ranges.bySlug.get(row.slug))),
    live,
    anchors,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
