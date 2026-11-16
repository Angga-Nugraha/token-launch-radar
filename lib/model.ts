// Token Radar model radar-3: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot's own watchlist rule would keep: no token
// recorded, and not a wrapped, staked or bridged product of a token that already trades. The
// watchlist is the floor (40 protocols at or above $50M TVL); the board adds every other protocol
// that passes the same rule below the floor (158 more here), because the radar exists to find the
// early ones. A protocol that records no token is said to record none, never that it has none.
//
// Implied value is a fitted size curve, not a flat multiple. A flat median mcap/TVL multiple
// prices a $2.8B-TVL protocol as if it were a small one; traded tokens do not scale that way.
// radar-3 fits, on the snapshot's own traded anchors, by ordinary least squares:
//
//   log10(mcap) = a + b * log10(TVL)          (anchors: mcap_usd > 0, tvl_usd > 0,
//                                              excluding CEX, Bridge and Canonical Bridge —
//                                              an exchange or a bridge is not a launch comp)
//   curve       = 10^(a + b * log10(TVL)) * 10^(family effect)
//   family effect = median log-residual of the protocol's category, shrunk toward 0 with
//                   4 pseudo comps: effect * n / (n + 4). Categories with no anchors get 0.
//   multiple    = curve / TVL                  (the fitted curve value at this TVL, per TVL;
//                                              the only multiple the model publishes, so the
//                                              dashboard can still recompute TVL x multiple x ...)
//   growth      = 1 + 0.75 * clamp(change_7d, -40, +60) / 100
//   age         = 0.55 + 0.45 * min(age_days, 730) / 730   (age unknown: 365 days)
//   implied     = max(1, round(curve * growth * age))
//               = max(1, round(TVL * multiple * growth * age))
//
// The curve is validated out of sample at build time (see validate()): leave-one-out over the
// anchors, and a time split (fit before 2025-01-01, test on listings from 2025 on), each against
// two baselines on the same test sets — a flat overall median multiple, and a flat category
// multiple (the radar-2 rule). The numbers are embedded in data.js, not hand-typed.
//
// Uncertainty: the P25–P75 band is implied * 10^(+/-0.6745 * residual_std) — the central half of
// a log-normal residual distribution with the fitted residual dispersion.
//
// Farm economics: a $1,000 ticket buys a pro-rata slice of a 10% airdrop,
// slice = implied * 0.10 * (1000 / TVL); fees are 8 transactions over 90 days at the first
// chain's per-transaction gas; hours are 2.5 of work. net = slice - fees. Verdict: FARM when
// net > 0 and slice >= 2 * fees, THIN when net > 0, else SKIP. All assumptions are stated on
// the page; the farm plan steps themselves are unchanged from radar-2.
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
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Pseudo comps shrinking each category's family effect toward 0. */
export const EFFECT_PSEUDO_COUNT = 4;

/** The farm ticket, the transactions it takes, and the hours it takes (stated assumptions). */
export const FARM_TICKET_USD = 1000;
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

/** One row's farm economics: the expected slice of a 10% airdrop, net of all fees. */
export interface FarmEconomics {
  ticket_usd: number;
  slice_usd: number;
  fees_usd: number;
  hours: number;
  net_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
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

/** Fit log10(mcap) = a + b*log10(TVL) by OLS on `list`, with shrunk category effects. */
export function fitCurve(list: SnapshotProtocol[]): CurveFit {
  const xs = list.map((p) => Math.log10(p.tvl_usd));
  const ys = list.map((p) => Math.log10(p.mcap_usd!));
  const n = list.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - meanX) ** 2;
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]!));
  const ssr = residuals.reduce((s, r) => s + r * r, 0);
  const sst = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const residualStd = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
  const rSquared = sst === 0 ? 0 : 1 - ssr / sst;
  // Category effect: the median log-residual of the category's anchors, shrunk toward 0 with
  // EFFECT_PSEUDO_COUNT pseudo comps, so one comparable never sets an effect on its own.
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
    effects.set(cat, { n: rs.length, median_residual: med, effect: med * (rs.length / (rs.length + EFFECT_PSEUDO_COUNT)) });
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

export function calibrate(snapshot: Snapshot): Calibration {
  const anchors = tradedAnchors(snapshot);
  const curve = fitCurve(anchors);
  const multiples = anchors.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const overall = multiples.length > 0 ? median(multiples) : 0.2;
  const byCategory = new Map<string, { n: number; median_residual: number | null; effect: number }>();
  for (const cat of new Set(snapshot.protocols.map((p) => p.category ?? 'Other'))) {
    const e = curve.effects.get(cat);
    byCategory.set(cat, e === undefined ? { n: 0, median_residual: null, effect: 0 } : { n: e.n, median_residual: e.median_residual, effect: e.effect });
  }
  return { overall, curve, byCategory };
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
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
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
 * The farm economics for one row: a $1,000 ticket's pro-rata slice of a 10% airdrop,
 * net of 8 transactions of gas on the protocol's first chain over 90 days and 2.5 hours
 * of work. FARM when the slice covers the fees twice over, THIN when it merely covers them.
 */
export function farmEconomics(p: SnapshotProtocol, implied: number): FarmEconomics {
  const slice = p.tvl_usd > 0 ? round2(implied * FARM_AIRDROP_SHARE * (FARM_TICKET_USD / p.tvl_usd)) : 0;
  const fees = round2(FARM_TX_COUNT * gasUsd(p.chains.length > 0 ? p.chains[0]! : ''));
  const net = round2(slice - fees);
  const verdict: FarmEconomics['verdict'] = net > 0 && slice >= 2 * fees ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
  return { ticket_usd: FARM_TICKET_USD, slice_usd: slice, fees_usd: fees, hours: FARM_HOURS, net_usd: net, verdict };
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
    farm: farmEconomics(s.p, s.v.implied),
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

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Every step names what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: gas.replace('per transaction', 'for the first transaction'),
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Repeat one qualifying action each week on ${chain}, such as a deposit, a swap, a vote or a claim, so the wallet stays active.`,
      cost: gas.replace('per transaction', 'a week'),
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open ${p.name}'s own points or rewards page in its app and check your balance; claim only from the link the app itself publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Keep this farm under 10% of your farm bankroll: never deposit funds you need back this month, and never borrow against the position.`,
      cost: 'nothing but discipline',
      time: '5 minutes to size it',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and plan your exit: unstake, withdraw and revoke the approval.`,
      cost: gas.replace('per transaction', 'to unwind'),
      time: '10 minutes to log it',
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
export function radarRow(row: BoardRow): RadarRow {
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
      residual_std: round4(curve.residual_std),
      r_squared: round4(curve.r_squared),
    },
    validation: validate(snapshot),
    rows: board.map(radarRow),
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
