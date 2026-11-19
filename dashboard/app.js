// Token Radar radar-4: a static page, no framework and no network. It renders the board from
// the data this program wrote beside it. The model lives in model.js and recomputes every
// row's implied value, band and farm economics (dollar-days slice, T-bill deducted) from the
// snapshot figures, so the page, the board and the code agree with each other.
'use strict';

const main = document.querySelector('#board');
const DATA = window.RADAR;
const M = window.RADAR_MODEL;
if (!DATA) {
  main.innerHTML = '<div class="empty"><h2>Token Radar: the board is missing</h2><p>data.js was not found beside this page. Run the program to write it, then reload.</p></div>';
  main.setAttribute('aria-busy', 'false');
  throw new Error('window.RADAR is missing');
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n)}`;
};
const moneyExact = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const ageText = (days) => {
  if (days === null || days === undefined) return 'unknown';
  if (days < 30) return `${days}d`;
  const m = Math.floor(days / 30);
  if (m < 12) return `${m}mo`;
  return `${Math.floor(m / 12)}y ${m % 12}mo`;
};
const changeText = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const chainText = (chains) => {
  if (!chains || chains.length === 0) return 'no chain listed';
  const shown = chains.slice(0, 3).join(', ');
  return chains.length > 3 ? `${shown} +${chains.length - 3} more` : shown;
};

const CATEGORIES = [...new Set(DATA.rows.map((r) => r.category).filter(Boolean))].sort();
const CHAINS = [...new Set(DATA.rows.flatMap((r) => r.chains))].sort();
const MAX_IMPLIED = Math.max(...DATA.rows.map((r) => r.implied_value_usd));
const SORTS = {
  rank: { label: 'Rank', key: (r) => r.rank, dir: 1 },
  tvl: { label: 'TVL', key: (r) => r.tvl_usd, dir: -1 },
  change: { label: '7d change', key: (r) => (r.change_7d === null ? -Infinity : r.change_7d), dir: -1 },
  age: { label: 'Age', key: (r) => (r.age_days === null ? -1 : r.age_days), dir: -1 },
  multiple: { label: 'Multiple', key: (r) => r.multiple, dir: -1 },
  implied: { label: 'Implied value', key: (r) => r.implied_value_usd, dir: -1 },
  slice: { label: 'Airdrop slice', key: (r) => r.farm.slice_usd, dir: -1 },
  net: { label: 'Net', key: (r) => r.farm.net_usd, dir: -1 },
  verdict: { label: 'Verdict', key: (r) => ({ FARM: 0, THIN: 1, SKIP: 2 })[r.farm.verdict] ?? 3, dir: 1 },
};
const MIN_TVL = [['', 'Any TVL'], ['10000000', '≥ $10M'], ['50000000', '≥ $50M'], ['100000000', '≥ $100M'], ['500000000', '≥ $500M'], ['1000000000', '≥ $1B'], ['5000000000', '≥ $5B']];

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return {
    tab: h.get('tab') || 'pre',
    q: h.get('q') || '',
    category: h.get('category') || '',
    chain: h.get('chain') || '',
    watch: h.get('watchlist') === '1',
    minTvl: h.get('minTvl') || '',
    sort: SORTS[h.get('sort')] ? h.get('sort') : 'rank',
    slug: h.get('p') || '',
  };
}
let state = readHash();
let wi = { ticket: 1000, share: 10, tbill: 4 };
function writeHash() {
  const h = new URLSearchParams();
  if (state.tab !== 'pre') h.set('tab', state.tab);
  if (state.q) h.set('q', state.q);
  if (state.category) h.set('category', state.category);
  if (state.chain) h.set('chain', state.chain);
  if (state.watch) h.set('watchlist', '1');
  if (state.minTvl) h.set('minTvl', state.minTvl);
  if (state.sort !== 'rank') h.set('sort', state.sort);
  if (state.slug) h.set('p', state.slug);
  const s = h.toString();
  history.replaceState(null, '', s ? `#${s}` : location.pathname);
}


const REASON = { bridge: 'Bridge', liquid_staking: 'Liquid staking', exchange_custody: 'Exchange custody', versioned_listing: 'Versioned listing', wrapped_staked: 'Wrapped / staked', kin_of_token: 'Kin of a token' };
const beText = (be) => be === null ? '—' : be > 1 ? `${(be * 100).toFixed(0)}% — never pays at any launch odds` : `${(be * 100).toFixed(1)}% launch odds`;
function wfTable() {
  const w = DATA.walk_forward;
  const row = (o) => `<tr><td>${Math.round(o.fraction * 100)}%</td><td class="num">${o.train_n}/${o.test_n}</td><td class="num">${o.curve.median_miss.toFixed(2)}×</td><td class="num">${o.curve.within_3x_pct.toFixed(1)}%</td><td class="num">${o.board.median_miss.toFixed(2)}×</td><td class="num">${o.flat_multiple.median_miss.toFixed(2)}×</td></tr>`;
  return `<table class="calib"><thead><tr><th scope="col">Origin</th><th scope="col">Train/test</th><th scope="col">Curve miss</th><th scope="col">Curve ≤3×</th><th scope="col">Board miss</th><th scope="col">Flat miss</th></tr></thead><tbody>${w.origins.map(row).join('')}<tr><td><b>Overall (120 tests)</b></td><td class="num">—</td><td class="num"><b>${w.overall_curve.median_miss.toFixed(2)}×</b></td><td class="num">${w.overall_curve.within_3x_pct.toFixed(1)}%</td><td class="num"><b>${w.overall_board.median_miss.toFixed(2)}×</b></td><td class="num">${w.overall_flat.median_miss.toFixed(2)}×</td></tr></tbody></table><p>Curve and flat score the fitted curve only (same basis as LOO); board scores the shipped formula, curve × growth × maturity.</p>`;
}
function ablTable() {
  const a = DATA.ablation;
  const d = (v) => (v === 0 ? '—' : (v > 0 ? '+' : '') + v.toFixed(2));
  return `<p>Keep rule: “${esc(a.keep_rule)}” (paired bootstrap, 2000 draws, seed 1).</p><table class="calib"><thead><tr><th scope="col">Rung</th><th scope="col">LOO miss</th><th scope="col">≤3×</th><th scope="col">RANK</th><th scope="col">WF miss</th><th scope="col">Δ LOO</th><th scope="col">Δ WF</th><th scope="col">SE</th><th scope="col">Rule</th></tr></thead><tbody>${a.rungs.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.loo_miss.toFixed(2)}×</td><td class="num">${r.loo_within_3x_pct.toFixed(1)}%</td><td class="num">${r.loo_spearman.toFixed(3)}</td><td class="num">${r.wf_miss.toFixed(2)}×</td><td class="num">${d(r.delta_loo)}</td><td class="num">${d(r.delta_wf)}</td><td class="num">${r.se === 0 ? '—' : r.se.toFixed(3)}</td><td><span class="verdict ${r.rule === 'KEPT' ? 'verdict-farm' : ''}">${r.rule}</span></td></tr>`).join('')}</tbody></table><ul class="rules">${a.rungs.map((r) => `<li><b>${esc(r.name)}:</b> ${esc(r.rule_detail)}</li>`).join('')}</ul>`;
}
function rejTable() {
  const a = DATA.ablation;
  return `<table class="calib"><thead><tr><th scope="col">Rejected try</th><th scope="col">LOO</th><th scope="col">WF</th><th scope="col">Time-split</th><th scope="col">TS rank</th><th scope="col">Why rejected</th></tr></thead><tbody>${a.rejected.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.loo_miss.toFixed(2)}×</td><td class="num">${r.wf_miss.toFixed(2)}×</td><td class="num">${r.ts_miss.toFixed(2)}×</td><td class="num">${r.ts_spearman.toFixed(3)}</td><td>${esc(r.reason)}</td></tr>`).join('')}</tbody></table>`;
}
function ledgerTabHtml() {
  if (state.tab === 'traded') return `<div class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Protocol</th><th scope="col">Category</th><th scope="col">TVL</th><th scope="col">Market cap</th><th scope="col">7d change</th></tr></thead><tbody>${DATA.traded.map((t) => `<tr><td><span class="name"><b>${esc(t.name)}</b><span class="sub">${esc(t.slug)}</span></span></td><td>${esc(t.category || 'Uncategorized')}</td><td class="num">${money(t.tvl_usd)}</td><td class="num">${money(t.mcap_usd)}</td><td class="num ${t.change_7d >= 0 ? 'pos' : 'neg'}">${changeText(t.change_7d)}</td></tr>`).join('')}</tbody></table></div></div><p class="note" style="margin-top:12px">These ${DATA.traded.length} protocols already trade a token, so they are the curve's anchors and the board's comparables — not launches to rank.</p>`;
  if (state.tab === 'record') return `<div class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Protocol</th><th scope="col">Category</th><th scope="col">Symbol</th><th scope="col">CoinGecko id</th></tr></thead><tbody>${DATA.on_record.map((t) => `<tr><td><span class="name"><b>${esc(t.name)}</b><span class="sub">${esc(t.slug)}</span></span></td><td>${esc(t.category || 'Uncategorized')}</td><td class="num">${esc(t.symbol || '—')}</td><td>${esc(t.gecko_id || '—')}</td></tr>`).join('')}</tbody></table></div></div><p class="note" style="margin-top:12px">These ${DATA.on_record.length} protocols record a token in the snapshot, so they are off the board: a token on record is not a launch.</p>`;
  if (state.tab === 'setaside') return `<div class="panel"><div class="table-wrap"><table><thead><tr><th scope="col">Protocol</th><th scope="col">Category</th><th scope="col">Set aside because</th></tr></thead><tbody>${DATA.set_aside.map((t) => `<tr><td><span class="name"><b>${esc(t.name)}</b><span class="sub">${esc(t.slug)}</span></span></td><td>${esc(t.category || 'Uncategorized')}</td><td>${esc(REASON[t.reason] || t.reason)}</td></tr>`).join('')}</tbody></table></div></div><p class="note" style="margin-top:12px">Set aside by the board's exclusion rule, first matching rule wins: bridge ${DATA.ledger.set_aside.bridge}, liquid staking ${DATA.ledger.set_aside.liquid_staking}, exchange custody ${DATA.ledger.set_aside.exchange_custody}, versioned listing ${DATA.ledger.set_aside.versioned_listing}, wrapped / staked ${DATA.ledger.set_aside.wrapped_staked}, kin of a token ${DATA.ledger.set_aside.kin_of_token}.</p>`;
  return '';
}
function tabHtml() {
  if (state.tab === 'traded' || state.tab === 'record' || state.tab === 'setaside') return ledgerTabHtml();
  if (state.tab === 'method') return methodHtml();
  return '';
}

function filteredRows() {
  let rows = DATA.rows.slice();
  const q = state.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => `${r.name} ${r.slug} ${r.category || ''}`.toLowerCase().includes(q));
  if (state.category) rows = rows.filter((r) => r.category === state.category);
  if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
  if (state.watch) rows = rows.filter((r) => r.watchlist);
  if (state.minTvl) rows = rows.filter((r) => r.tvl_usd >= Number(state.minTvl));
  const sort = SORTS[state.sort];
  rows.sort((a, b) => (sort.key(a) - sort.key(b)) * sort.dir || a.rank - b.rank);
  return rows;
}

function th(label, key) {
  const sort = SORTS[state.sort];
  const arrow = state.sort === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
  return `<th scope="col"><button data-sort="${key}" aria-sort="${state.sort === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}">${label}${arrow}</button></th>`;
}

function rowHtml(r) {
  const implied = M.impliedValue(r);
  const mismatch = implied !== r.implied_value_usd;
  const b = M.band(implied);
  const v = r.farm.verdict;
  return `<tr data-slug="${esc(r.slug)}" data-selected="${state.slug === r.slug}" class="${r.watchlist ? 'watch' : ''}">
    <td class="num">${r.rank}<br><span class="sub">${r.rank_min}–${r.rank_max}</span></td>
    <td><span class="name"><b>${esc(r.name)}</b><span class="sub">${esc(r.category || 'Uncategorized')} · ${esc(chainText(r.chains))} · ${ageText(r.age_days)}</span></span></td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${changeText(r.change_7d)}</td>
    <td class="num">${r.multiple.toFixed(2)}×</td>
    <td><span class="implied"><span class="bar"><i style="width:${Math.max(2, Math.round((r.implied_value_usd / MAX_IMPLIED) * 100))}%"></i></span><span class="num">${money(r.implied_value_usd)}</span>${mismatch ? '<span class="neg" title="The page recomputes this value">?</span>' : ''}</span></td>
    <td class="num">${money(b.p25)}–${money(b.p75)}</td>
    <td class="num">$${r.farm.slice_usd.toFixed(2)}</td>
    <td class="num ${r.farm.net_usd >= 0 ? 'pos' : 'neg'}">$${r.farm.net_usd.toFixed(2)}</td>
    <td><span class="verdict verdict-${v.toLowerCase()}">${v}</span></td>
    <td><span class="badge ${r.watchlist ? 'watch' : ''}">${r.watchlist ? 'Watchlist' : 'Early radar'}</span></td>
  </tr>`;
}

function liveHtml(l) {
  return `<tr>
    <td><span class="name"><b>${esc(l.name)}</b><span class="sub">${esc(l.category || 'Uncategorized')} · ${esc(chainText(l.chains))}</span></span></td>
    <td class="num">${money(l.tvl_usd)}</td>
    <td class="num ${l.change_7d === null ? '' : l.change_7d >= 0 ? 'pos' : 'neg'}">${changeText(l.change_7d)}</td>
    <td class="num">${l.mcap_usd === null ? '—' : money(l.mcap_usd)}</td>
    <td class="num">${l.fdv_tvl === null ? '—' : `${l.fdv_tvl.toFixed(2)}×`}</td>
  </tr>`;
}

function validRow(label, v) {
  return `<tr><td>${label}</td><td class="num">${v.median_miss.toFixed(2)}×</td><td class="num">${v.within_2x_pct.toFixed(1)}%</td><td class="num">${v.within_3x_pct.toFixed(1)}%</td><td class="num">${v.spearman.toFixed(2)}</td></tr>`;
}
function validTable(set) {
  return `<table class="calib"><thead><tr><th scope="col">Method</th><th scope="col">Median miss</th><th scope="col">Within 2×</th><th scope="col">Within 3×</th><th scope="col">Spearman</th></tr></thead><tbody>${validRow('Size curve (Huber, radar-4)', set.curve)}${validRow('Flat multiple', set.flat_multiple)}${validRow('Category multiple (radar-2)', set.category_multiple)}</tbody></table>`;
}

/** Log-log scatter: traded protocols in this file, board implied values, fitted curve. */
function scatterSvg() {
  const anchorPts = DATA.anchors;
  const rows = DATA.rows;
  const W = 720, H = 400, PL = 56, PR = 12, PT = 14, PB = 40;
  const xs = anchorPts.map((l) => l.tvl_usd).concat(rows.map((r) => r.tvl_usd));
  const ys = anchorPts.map((l) => l.mcap_usd).concat(rows.map((r) => r.implied_value_usd));
  const x0 = Math.floor(Math.log10(Math.min(...xs))), x1 = Math.ceil(Math.log10(Math.max(...xs)));
  const y0 = Math.floor(Math.log10(Math.min(...ys))), y1 = Math.ceil(Math.log10(Math.max(...ys)));
  const X = (v) => PL + ((Math.log10(v) - x0) / (x1 - x0)) * (W - PL - PR);
  const Y = (v) => PT + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - PT - PB);
  const tick = (v) => (v >= 1e9 ? `$${v / 1e9}B` : v >= 1e6 ? `$${v / 1e6}M` : `$${v / 1e3}K`);
  let g = '';
  for (let e = x0; e <= x1; e++) { const x = X(10 ** e).toFixed(1); g += `<line x1="${x}" y1="${PT}" x2="${x}" y2="${H - PB}" class="grid"/><text x="${x}" y="${H - PB + 18}" class="ax">${tick(10 ** e)}</text>`; }
  for (let e = y0; e <= y1; e++) { const y = Y(10 ** e).toFixed(1); g += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" class="grid"/><text x="${PL - 6}" y="${(+y + 4).toFixed(1)}" class="ax" text-anchor="end">${tick(10 ** e)}</text>`; }
  let line = '';
  for (let lx = x0; lx <= x1; lx += 0.1) line += `${X(10 ** lx).toFixed(1)},${Y(10 ** (DATA.curve.intercept + DATA.curve.slope * lx)).toFixed(1)} `;
  const dots = rows.map((r) => `<circle cx="${X(r.tvl_usd).toFixed(1)}" cy="${Y(r.implied_value_usd).toFixed(1)}" r="2.2" class="board-dot"/>`).join('');
  const anchors = anchorPts.map((l) => `<circle cx="${X(l.tvl_usd).toFixed(1)}" cy="${Y(l.mcap_usd).toFixed(1)}" r="3.4" class="anchor-dot"><title>${esc(l.name)}: ${money(l.tvl_usd)} TVL, ${money(l.mcap_usd)} mcap</title></circle>`).join('');
  return `<svg class="scatter" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter plot of market cap against TVL on log scales, with the fitted curve">${g}<polyline points="${line}" class="curve-line"/>${dots}${anchors}<text x="${((W + PL) / 2).toFixed(0)}" y="${H - 6}" class="ax">TVL (log scale)</text><text x="14" y="${((H + PT - PB) / 2).toFixed(0)}" class="ax" text-anchor="middle" transform="rotate(-90 14 ${((H + PT - PB) / 2).toFixed(0)})">Value (log scale)</text></svg>
  <p class="legend"><span class="lg anchor-dot"></span> Traded anchors (${anchorPts.length}) &nbsp; <span class="lg board-dot"></span> Board implied values (${rows.length}) &nbsp; <span class="lg curve-line"></span> Fitted curve, no family effect</p>`;
}

function methodHtml() {
  const c = DATA.curve, v = DATA.validation, m = DATA.model;
  const loo = v.loo, ts = v.time_split;
  return `<section class="panel method" aria-label="Method and tests">
    <h2>Method &amp; tests</h2>
    <p>The model is a fitted size curve, not a flat multiple. Huber IRLS (c = 1.345, scale 1.4826 × MAD, refitted every iteration) on log10(mcap) against log10(TVL) over ${c.anchors} traded anchors, plus one shrunk effect per category: the median log-residual, shrunk toward 0 with k = 12 pseudo comps and a min_n = 3 floor, so a category with fewer than 3 anchors gets no effect.</p>
    <div class="formula">log10(mcap) = ${c.intercept.toFixed(4)} + ${c.slope.toFixed(4)} × log10(TVL) + family effect<br>implied = 10^(curve) × (1 + ${m.growth_weight} × clamp(change_7d, ${m.growth_floor}, ${m.growth_cap}) / 100) × (${m.maturity_floor} + min(age_days, ${m.maturity_days}) / ${m.maturity_days} × ${m.maturity_range})<br>R² = ${c.r_squared}, residual std = ${c.residual_std.toFixed(4)} (log10), anchors = ${c.anchors}</div>
    <p>Growth is the 7-day TVL change; maturity rises from ${m.maturity_floor} at listing to 1.00 over ${m.maturity_days} days, and a protocol with no listing date counts as ${m.unknown_age_days} days. Growth and maturity are stated board assumptions, not fitted regressors. No chain spread: the curve already prices size. The P25–P75 band is implied × 10^(±0.6745 × ${c.residual_std.toFixed(4)}).</p>
    <h3>Walk-forward validation — 5 origins by listed_at (80 dated anchors)</h3>
    ${wfTable()}
    <h3>Ablation — every rung kept or rejected by rule</h3>
    ${ablTable()}
    <h3>Rejected tries</h3>
    ${rejTable()}
    <h3>Out-of-sample validation — leave-one-out (n = ${loo.n})</h3>
    ${validTable(loo)}
    <h3>Out-of-sample validation — time split (${esc(ts.split)}; train ${ts.train_n}, test ${ts.test_n})</h3>
    ${validTable(ts)}
    <p class="note">Bands hold: P25–P75 ${DATA.bands_hold.p25_p75_pct}% · P10–P90 ${DATA.bands_hold.p10_p90_pct}% (aim 50, 80), n = ${DATA.bands_hold.n} leave-one-out predictions. ${esc(DATA.not_tvl_alone.text)} — the model adds information beyond sorting by TVL. ${esc(DATA.rank_ranges.summary)}: rank ranges from ${DATA.rank_ranges.refits} bootstrap refits are shown under every rank on the board. Absolute accuracy is still poor: only ${loo.curve.within_3x_pct}% of leave-one-out predictions land within 3×. The wide P25–P75 bands say the same thing.</p>
    ${scatterSvg()}
    <h3>Calibration — family effect by category</h3>
    <table class="calib"><thead><tr><th scope="col">Category</th><th scope="col">Comparables</th><th scope="col">Median residual</th><th scope="col">Effect</th><th scope="col">Effect multiplier</th></tr></thead>
    <tbody>${DATA.calibration.map((c2) => `<tr><td>${esc(c2.category)}</td><td class="num">${c2.comparables}</td><td class="num">${c2.median_residual === null ? '—' : c2.median_residual.toFixed(2)}</td><td class="num">${c2.effect.toFixed(2)}</td><td class="num">${c2.effect_multiplier.toFixed(2)}×</td></tr>`).join('')}</tbody></table>
    <h3>Farm economics — stated assumptions</h3>
    <p>Every row's farm economics assume a $${DATA.rows[0].farm.ticket_usd.toLocaleString('en-US')} ticket, a launch that airdrops 10% of implied value shared by dollar-days: a hold of H days (60 if age &lt; 180d, 45 if &lt; 365d, else 30) stands behind min(H, age) / 2 day-equivalents, so a protocol younger than the hold can never pay more than its time-weighted slice. Fees are 8 × the per-transaction gas of the protocol's first chain, the T-bill yield forgone (4% a year on the ticket) is deducted too, and the work is ${DATA.rows[0].farm.hours} hours. Verdict: FARM when the slice covers the total cost twice over, THIN when it merely covers it, else SKIP. ${DATA.rows.filter((r) => r.farm.verdict === 'FARM').length} rows are FARM, ${DATA.rows.filter((r) => r.farm.verdict === 'THIN').length} THIN, ${DATA.rows.filter((r) => r.farm.verdict === 'SKIP').length} SKIP.</p>
  </section>`;
}

function render() {
  const rows = filteredRows();
  const top = DATA.rows.slice(0, 5);
  const topImplied = DATA.rows[0];
  const totalImplied = DATA.rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const missed = DATA.rows.filter((r) => !r.watchlist).sort((a, b) => b.tvl_usd - a.tvl_usd)[0];
  main.innerHTML = `<div class="shell">
    <header class="top">
      <div class="brand"><span class="mark" aria-hidden="true"></span><span class="brand-name">Token Radar · ${esc(DATA.model_version)}</span></div>
      <div class="top-meta"><span>Snapshot ${esc(DATA.as_of)}</span><span>${esc(DATA.source)}</span><span>Model ${esc(DATA.model_version)}</span></div>
    </header>
    <section class="kpi" aria-label="Key figures">
      <div><span>Ranked</span><b>${DATA.kpis.ranked}</b><small>pre-token protocols</small></div>
      <div><span>Implied value</span><b>${money(DATA.kpis.implied_total_usd)}</b><small>board total</small></div>
      <div><span>Held-out miss</span><b>${DATA.kpis.loo_miss.toFixed(2)}×</b><small>LOO · ${DATA.kpis.ts_miss.toFixed(2)}× time-split</small></div>
      <div><span>Range holds</span><b>${DATA.kpis.range_holds_p25_p75_pct.toFixed(2)}%</b><small>P25–P75 bands, aim 50</small></div>
      <div><span>Worth farming</span><b>${DATA.kpis.worth_farming} FARM</b><small>${DATA.rows.filter((r) => r.farm.verdict === 'THIN').length} THIN · ${DATA.rows.filter((r) => r.farm.verdict === 'SKIP').length} SKIP</small></div>
      <div><span>Best $/hour</span><b>$${DATA.kpis.best_per_hour_10k_usd.toFixed(2)}</b><small>$${DATA.kpis.best_per_hour_usd.toFixed(2)}/h on a $1,000 ticket</small></div>
    </section>
    <section class="ledger" aria-label="758 protocols accounted for">
      <h2>758 protocols accounted for</h2>
      <div class="counts"><span>Ranked <b>${DATA.ledger.ranked}</b></span><span>Token trades <b>${DATA.ledger.token_trades}</b></span><span>Token on record <b>${DATA.ledger.token_on_record}</b></span><span>Set aside <b>${DATA.ledger.set_aside_total}</b></span><span class="sub">bridge ${DATA.ledger.set_aside.bridge} · liquid staking ${DATA.ledger.set_aside.liquid_staking} · exchange custody ${DATA.ledger.set_aside.exchange_custody} · versioned listing ${DATA.ledger.set_aside.versioned_listing} · wrapped / staked ${DATA.ledger.set_aside.wrapped_staked} · kin of a token ${DATA.ledger.set_aside.kin_of_token}</span></div>
      <p class="checks">Bands hold P25–P75 ${DATA.bands_hold.p25_p75_pct}% · P10–P90 ${DATA.bands_hold.p10_p90_pct}% (aim 50, 80) · ${esc(DATA.not_tvl_alone.text)} · ${esc(DATA.rank_ranges.summary)}.</p>
    </section>
    <section class="lede" aria-label="What this board is">
      <div>
        <h1>Every protocol with no token yet, ranked by what its launch would be worth.</h1>
        <p>DefiLlama's watchlist keeps <b>${DATA.watchlist_size} protocols</b> at or above <b>$50M TVL</b>. This radar keeps them all — and adds the <b>${DATA.early_size} the watchlist missed</b> that pass the same rule: no token recorded, and not a wrapped, staked or bridged product of a token that already trades. The biggest one the watchlist missed is <b>${esc(missed.name)}</b>, <b>${money(missed.tvl_usd)}</b> TVL, ranked <b>#${missed.rank}</b>. Every row carries an implied value and a farm plan. A protocol that records no token is said to record none, never that it has none.</p>
      </div>
      <div class="facts" aria-label="Facts">
        <div class="fact"><span>Protocols ranked</span><b>${DATA.board_size}</b></div>
        <div class="fact"><span>Watchlist covered</span><b>${DATA.watchlist_size} of ${DATA.watchlist_size}</b></div>
        <div class="fact"><span>Early radar (outside watchlist)</span><b>${DATA.early_size}</b></div>
        <div class="fact"><span>Off the board</span><b>${DATA.ledger.total - DATA.board_size}</b></div>
        <div class="fact"><span>Highest implied value</span><b>${money(topImplied.implied_value_usd)} · ${esc(topImplied.name)}</b></div>
        <div class="fact"><span>Total implied value</span><b>${money(totalImplied)}</b></div>
        <div class="fact"><span>Anchors' median mcap/TVL</span><b>${DATA.overall_multiple.toFixed(2)}×</b></div>
        <div class="fact"><span>Out-of-sample LOO miss</span><b>${DATA.validation.loo.curve.median_miss.toFixed(2)}× (flat ${DATA.validation.loo.flat_multiple.median_miss.toFixed(2)}×)</b></div>
      </div>
    </section>
    <section class="spot" aria-label="Top five by implied value">
      ${top.map((r) => `<button class="spot-card" data-slug="${esc(r.slug)}"><span class="spot-rank">#${r.rank}</span><b>${esc(r.name)}</b><span class="num">${money(r.implied_value_usd)}</span><span class="sub">${money(r.tvl_usd)} TVL · ${r.multiple.toFixed(2)}× multiple</span></button>`).join('')}
    </section>
    <section class="best" aria-label="Best farms now">
      <span><b>Best farms now, by net on $10,000:</b></span>
      ${DATA.best_farms.map((f) => `<span>${esc(f.name)} <b>$${f.net_usd.toFixed(2)} net · $${f.per_hour_usd.toFixed(2)}/h</b> · fees $${f.fees_usd.toFixed(2)} · ${f.days}d</span>`).join('')}
      <span class="pf">FARM + THIN ${DATA.portfolio.farm_thin_count} rows · costs $${DATA.portfolio.costs_usd.toFixed(2)} · net $${DATA.portfolio.net_usd.toFixed(2)} · ${DATA.portfolio.hours}h</span>
    </section>
    <div class="controls">
      <div class="field"><label for="q">Search</label><input id="q" type="search" value="${esc(state.q)}" placeholder="Name, slug or category" autocomplete="off"></div>
      <div class="field"><label for="category">Category</label><select id="category"><option value="">All categories</option>${CATEGORIES.map((c) => `<option value="${esc(c)}" ${state.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="chain">Chain</label><select id="chain"><option value="">All chains</option>${CHAINS.map((c) => `<option value="${esc(c)}" ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="minTvl">Minimum TVL</label><select id="minTvl">${MIN_TVL.map(([v, l]) => `<option value="${v}" ${state.minTvl === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="check"><input type="checkbox" id="watch" ${state.watch ? 'checked' : ''}> Watchlist only</label>
      <div class="tabs" role="group" aria-label="Board, live token or method view">
        <button data-tab="pre" aria-pressed="${state.tab === 'pre'}">Pre-token</button>
        <button data-tab="traded" aria-pressed="${state.tab === 'traded'}">Token trades</button>
        <button data-tab="record" aria-pressed="${state.tab === 'record'}">Token on record</button>
        <button data-tab="setaside" aria-pressed="${state.tab === 'setaside'}">Set aside</button>
        <button data-tab="live" aria-pressed="${state.tab === 'live'}">Live token</button>
        <button data-tab="method" aria-pressed="${state.tab === 'method'}">Method &amp; tests</button>
      </div>
      <span class="count" aria-live="polite">${state.tab === 'pre' ? `${rows.length} of ${DATA.board_size} rows` : state.tab === 'live' ? `${DATA.live.length} live-token protocols` : state.tab === 'traded' ? `${DATA.traded.length} protocols already trade a token` : state.tab === 'record' ? `${DATA.on_record.length} protocols record a token` : state.tab === 'setaside' ? `${DATA.set_aside.length} protocols set aside by rule` : 'Fitted curve, backtests and calibration'}</span>
    </div>
    ${state.tab === 'pre' ? `<div class="panel"><div class="table-wrap"><table>
      <caption class="sr-only" style="position:absolute;left:-9999px">Pre-token protocols ranked by implied value</caption>
      <thead><tr>${th('Rank', 'rank')}<th scope="col">Protocol</th>${th('TVL', 'tvl')}${th('7d change', 'change')}${th('Multiple', 'multiple')}${th('Implied value', 'implied')}<th scope="col">P25–P75</th>${th('Slice', 'slice')}${th('Net', 'net')}${th('Verdict', 'verdict')}<th scope="col">Status</th></tr></thead>
      <tbody>${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="11"><div class="empty"><h2>Nothing matches</h2><p>No protocol fits these filters. Clear the search or widen the filters.</p><button class="button" data-clear="1">Clear filters</button></div></td></tr>`}</tbody>
    </table></div></div>` : state.tab === 'live' ? `<div class="panel"><div class="table-wrap"><table>
      <caption class="sr-only" style="position:absolute;left:-9999px">Live-token protocols by market cap</caption>
      <thead><tr><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d change</th><th scope="col">Market cap</th><th scope="col">FDV/TVL</th></tr></thead>
      <tbody>${DATA.live.map(liveHtml).join('')}</tbody>
    </table></div></div>
    <p class="note" style="margin-top:12px">These ${DATA.live.length} protocols already trade, so the board shows the market's own value for them instead of a model's. The curve is fitted on the traded anchors, not on these rows alone.</p>` : tabHtml()}
    ${state.tab === 'method' ? '' : `<section class="panel model" aria-label="How the model works">
      <h2>How the implied value is built</h2>
      <p>A fitted size curve, not a flat multiple: log10(mcap) = ${DATA.curve.intercept} + ${DATA.curve.slope} × log10(TVL), fitted by Huber IRLS (c = 1.345) on ${DATA.curve.anchors} traded anchors, plus a shrunk category effect (k = 12, min_n = 3) — then growth (7-day TVL change, clamped ${DATA.model.growth_floor}% to +${DATA.model.growth_cap}%, weighted ${DATA.model.growth_weight}) and maturity (from ${DATA.model.maturity_floor} at listing to 1.00 over ${DATA.model.maturity_days} days; no listing date counts as ${DATA.model.unknown_age_days} days). No chain spread: the curve already prices size. Walk-forward (5 origins), the ablation table with kept/rejected rungs, rank ranges from 200 refits, and the full backtests are in the <b>Method &amp; tests</b> tab.</p>
      <div class="formula">implied = 10^(${DATA.curve.intercept} + ${DATA.curve.slope} × log10(tvl_usd) + family effect)<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;× (1 + ${DATA.model.growth_weight} × clamp(change_7d, ${DATA.model.growth_floor}, ${DATA.model.growth_cap}) / 100) × (${DATA.model.maturity_floor} + min(age_days, ${DATA.model.maturity_days}) / ${DATA.model.maturity_days} × ${DATA.model.maturity_range})</div>
      <p class="note">The board is a radar, not a promise: the median out-of-sample miss is ${DATA.validation.loo.curve.median_miss}× leave-one-out, so read every implied value with its P25–P75 band. A launch may never happen.</p>
    </section>`}
    <footer class="foot"><span>Source: ${esc(DATA.source)}, as of ${esc(DATA.as_of)}. Model ${esc(DATA.model_version)}.</span><span>“No token” means the snapshot records none for the protocol. Wrapping, staking and bridging products are excluded, so a wrapped or staked version of a token that trades never ranks as a launch.</span></footer>
  </div>
  <dialog class="detail" id="detail" aria-label="Protocol detail"></dialog>`;
  main.setAttribute('aria-busy', 'false');
  renderDetail();
}

function renderDetail() {
  const dlg = document.getElementById('detail');
  if (!dlg) return;
  const row = DATA.rows.find((r) => r.slug === state.slug);
  if (!row) {
    if (dlg.open) dlg.close();
    return;
  }
  const age = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
  const implied = M.impliedValue(row);
  const ev = M.farmEV(row, implied, { ticket: wi.ticket, share: wi.share / 100, tbill: wi.tbill / 100 });
  const b = M.band(implied);
  const calib = DATA.calibration.find((c) => c.category === (row.category || 'Other'));
  const comps = DATA.live.filter((l) => l.category === row.category).slice(0, 5);
  const steps = row.farm_steps;
  const wiSel = (id, vals, cur) => `<select id="${id}">${vals.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${id === 'wi-ticket' ? '$' + v.toLocaleString('en-US') : v + '%'}</option>`).join('')}</select>`;
  dlg.innerHTML = `<div class="detail-head"><div><span class="badge ${row.watchlist ? 'watch' : ''}">#${row.rank} · ${row.watchlist ? 'Watchlist' : 'Early radar'} · rank range ${row.rank_min}–${row.rank_max} in 200 refits</span><h2>${esc(row.name)}</h2><p class="sub">${esc(row.category || 'Uncategorized')} · ${esc(row.chains.join(', ') || 'no chain listed')} · ${ageText(row.age_days)} · ${money(row.tvl_usd)} TVL</p></div><button class="close" data-close="1" aria-label="Close detail">Close ×</button></div>
  <section class="detail-section"><h3>Farm economics — $${ev.ticket_usd.toLocaleString('en-US')} ticket</h3>
    <div class="wi"><label>Deposit ${wiSel('wi-ticket', [1000, 5000, 25000], wi.ticket)}</label><label>To farmers ${wiSel('wi-share', [5, 10, 20], wi.share)}</label><label>T-bill yield ${wiSel('wi-tbill', [0, 4, 8], wi.tbill)}</label></div>
    <div class="equation">
      <div><span>Airdrop slice (dollar-days, ${ev.share * 100}% of implied)</span><b>$${ev.slice_usd.toFixed(2)}</b></div>
      <div><span>Your ${ev.farm_days} days stand behind ${ev.day_equivalents} day-equivalents</span><b>${ev.day_equivalents} / ${ev.farm_days}d</b></div>
      <div><span>Balances on the day would pay</span><b>$${ev.slice_snapshot_usd.toFixed(2)}</b></div>
      <div><span>Fees (8 transactions)</span><b>$${ev.fees_usd.toFixed(2)}</b></div>
      <div><span>− T-bill forgone ${ev.tbill_rate * 100}%, ${ev.farm_days}d</span><b>$${ev.tbill_usd.toFixed(2)}</b></div>
      <div><span>Total cost</span><b>$${ev.total_cost_usd.toFixed(2)}</b></div>
      <div><span>Time</span><b>${ev.hours} hours</b></div>
      <div class="total"><span>Net · $/hour</span><b>$${ev.net_usd.toFixed(2)} · $${ev.per_hour_usd.toFixed(2)}/h · ${ev.verdict}</b></div>
      <div><span>Break-even launch odds</span><b>${beText(ev.breakeven_odds)}</b></div>
      <div><span>Pays from</span><b>${ev.pays_from_usd === null ? 'no ticket pays' : '$' + ev.pays_from_usd.toLocaleString('en-US') + ' ticket'}</b></div>
    </div>
    <p>Verdict: FARM when the slice covers the total cost twice over, THIN when it merely covers it, else SKIP. The slice is dollar-days, not pro-rata: a ${ev.farm_days}-day hold earns ${ev.day_equivalents} day-equivalents against the protocol's lifetime dollar-days.</p>
  </section>
  <section class="detail-section"><h3>Farm plan — ${steps.length} steps</h3>
    <ol class="steps">${steps.map((st) => `<li><b>${esc(st.text)}</b><span class="cost">Cost: ${esc(st.cost)} · Time: ${esc(st.time)}</span></li>`).join('')}</ol>
    <p>Each step carries its when, cost and time. Step 6 is the stop rule; step 7 is the exit. The plan is the one the board file carries for this protocol.</p>
  </section>
  <section class="detail-section"><h3>Why it ranks #${row.rank}</h3>
    <div class="equation">
      <div><span>TVL</span><b>${moneyExact(row.tvl_usd)}</b></div>
      <div><span>Fitted curve at this TVL (${row.multiple.toFixed(2)}×, incl. family effect ×${(10 ** row.family_effect).toFixed(2)})</span><b>${moneyExact(Math.round(row.tvl_usd * row.multiple))}</b></div>
      <div><span>Growth (7d ${changeText(row.change_7d)})</span><b>× ${row.growth_multiplier.toFixed(3)}</b></div>
      <div><span>Maturity (${ageText(row.age_days)})</span><b>× ${row.maturity_multiplier.toFixed(3)}</b></div>
      <div><span>Chain spread (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'}, not modelled)</span><b>× ${row.chain_multiplier.toFixed(3)}</b></div>
      <div class="total"><span>Implied value</span><b>${moneyExact(row.implied_value_usd)}</b></div>
      <div><span>P25–P75 band</span><b>${moneyExact(b.p25)} – ${moneyExact(b.p75)}</b></div>
    </div>
    <p>${esc(row.name)} ranks #${row.rank} because it holds ${money(row.tvl_usd)} of TVL in ${esc(row.category || 'an uncategorized')} category, whose fitted curve value at this TVL is ${row.multiple.toFixed(2)}× TVL, and it has been live ${ageText(row.age_days)}. Its 7-day change is ${changeText(row.change_7d)}. The implied value is a model's estimate, not a price, and the launch may never happen.</p>
    ${calib ? `<p>Family effect for ${esc(calib.category)}: ${calib.comparables} comparable${calib.comparables === 1 ? '' : 's'}, median log-residual ${calib.median_residual === null ? '—' : calib.median_residual.toFixed(2)}, shrunk effect ${calib.effect.toFixed(2)} (×${calib.effect_multiplier.toFixed(2)}), shrunk toward 0 where comparables are few.</p>` : ''}
  </section>
  ${comps.length ? `<section class="detail-section"><h3>Comparable tokens in ${esc(row.category || 'this category')}</h3><div class="comps">${comps.map((c) => `<div class="comp"><span>${esc(c.name)}</span><b class="num">${c.fdv_tvl === null ? '—' : `${c.fdv_tvl.toFixed(2)}×`} FDV/TVL · ${money(c.tvl_usd)} TVL</b></div>`).join('')}</div></section>` : ''}`;
  if (!dlg.open) dlg.showModal();
}

main.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { state.slug = ''; writeHash(); renderDetail(); return; }
  const clearBtn = e.target.closest('[data-clear]');
  if (clearBtn) { state.q = ''; state.category = ''; state.chain = ''; state.watch = false; state.minTvl = ''; writeHash(); render(); return; }
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) { state.sort = sortBtn.dataset.sort; writeHash(); render(); return; }
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { state.tab = tabBtn.dataset.tab; writeHash(); render(); return; }
  const row = e.target.closest('[data-slug]');
  if (row) { state.slug = row.dataset.slug; writeHash(); render(); return; }
});
main.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; writeHash(); render(); const q = document.getElementById('q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
});
main.addEventListener('change', (e) => {
  if (e.target.id === 'category') { state.category = e.target.value; writeHash(); render(); }
  if (e.target.id === 'chain') { state.chain = e.target.value; writeHash(); render(); }
  if (e.target.id === 'minTvl') { state.minTvl = e.target.value; writeHash(); render(); }
  if (e.target.id === 'watch') { state.watch = e.target.checked; writeHash(); render(); }
  if (e.target.id === 'wi-ticket') { wi.ticket = Number(e.target.value); renderDetail(); }
  if (e.target.id === 'wi-share') { wi.share = Number(e.target.value); renderDetail(); }
  if (e.target.id === 'wi-tbill') { wi.tbill = Number(e.target.value); renderDetail(); }
});
document.addEventListener('click', (e) => {
  const dlg = document.getElementById('detail');
  if (dlg && dlg.open && e.target === dlg) { state.slug = ''; writeHash(); renderDetail(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.slug) { state.slug = ''; writeHash(); renderDetail(); }
});
window.addEventListener('hashchange', () => { state = readHash(); render(); });

render();
