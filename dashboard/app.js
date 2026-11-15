// Token Radar radar-2: a static page, no framework and no network. It renders the board from
// the data this program wrote beside it, and it recomputes every row's implied value from the
// snapshot figures, so the page, the board and the code agree with each other.
'use strict';

const main = document.querySelector('#board');
const DATA = window.RADAR;
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

/** What one transaction costs on a chain, in the words a farmer budgets by. */
function gasFor(chain) {
  if (chain === 'Ethereum') return 'about $3 to $8 of gas per transaction';
  if (chain === 'Solana') return 'under $0.05 of fees per transaction';
  if (chain === 'Bitcoin') return 'about $1 to $5 of network fees per transaction';
  if (chain === 'Tron') return 'about $1 to $3 of energy fees per transaction';
  if (['Arbitrum', 'Optimism', 'Base', 'Ink', 'Blast', 'Mode', 'Zora', 'Unichain', 'World Chain', 'Scroll', 'Linea', 'Polygon zkEVM', 'Mantle', 'Manta', 'Fraxtal', 'Abstract', 'Soneium', 'Berachain'].includes(chain)) return 'under $0.30 of gas per transaction';
  if (['Binance', 'Avalanche', 'Polygon', 'Gnosis', 'Fantom', 'Celo', 'Kava', 'Sei', 'Sui', 'Aptos', 'Near', 'Starknet', 'zkSync Era'].includes(chain)) return 'under $0.50 of gas per transaction';
  return 'under $1 of gas per transaction';
}
function capitalFor(tvl) {
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}
function holdDaysFor(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function actionFor(category, name, capital, chain) {
  const c = (category || '').toLowerCase();
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
function stepText(step) {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}
/** A protocol's farm plan, generated from its own record, in the same words as the board file. */
function farmSteps(row) {
  const chain = row.chains.length > 0 ? row.chains[0] : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(row.tvl_usd);
  const hold = holdDaysFor(row.age_days);
  const action = actionFor(row.category, row.name, capital, chain);
  return [
    { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas.replace('per transaction', 'for the first transaction'), time: '5 minutes' },
    { text: action, cost: `$${capital} of capital and ${gas}`, time: '15 minutes to set up' },
    { text: `Repeat one qualifying action each week on ${chain}, such as a deposit, a swap, a vote or a claim, so the wallet stays active.`, cost: gas.replace('per transaction', 'a week'), time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Open ${row.name}'s own points or rewards page in its app and check your balance; claim only from the link the app itself publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: 'Keep this farm under 10% of your farm bankroll: never deposit funds you need back this month, and never borrow against the position.', cost: 'nothing but discipline', time: '5 minutes to size it' },
    { text: 'Write the wallet, the dates and every transaction hash in a farm log, and plan your exit: unstake, withdraw and revoke the approval.', cost: gas.replace('per transaction', 'to unwind'), time: '10 minutes to log it' },
  ].map(stepText);
}

/** Implied value from the snapshot figures, recomputed in the page. */
function impliedValue(row) {
  const multiple = row.multiple;
  const growth = row.change_7d === null ? 0 : Math.min(25, Math.max(-25, row.change_7d));
  const growthMult = 1 + (growth / 100) * DATA.model.growth_weight;
  const age = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
  const maturityMult = DATA.model.maturity_floor + (Math.min(age, DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
  const chainMult = 1 + DATA.model.chain_bonus * Math.min(Math.max(row.chains.length - 1, 0), DATA.model.chain_bonus_max);
  return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturityMult * chainMult));
}

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
  const implied = impliedValue(r);
  const mismatch = implied !== r.implied_value_usd;
  return `<tr data-slug="${esc(r.slug)}" data-selected="${state.slug === r.slug}" class="${r.watchlist ? 'watch' : ''}">
    <td class="num">${r.rank}</td>
    <td><span class="name"><b>${esc(r.name)}</b><span class="sub">${esc(r.category || 'Uncategorized')} · ${esc(chainText(r.chains))} · ${ageText(r.age_days)}</span></span></td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${changeText(r.change_7d)}</td>
    <td class="num">${r.multiple.toFixed(2)}×</td>
    <td><span class="implied"><span class="bar"><i style="width:${Math.max(2, Math.round((r.implied_value_usd / MAX_IMPLIED) * 100))}%"></i></span><span class="num">${money(r.implied_value_usd)}</span>${mismatch ? '<span class="neg" title="The page recomputes this value">?</span>' : ''}</span></td>
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

function render() {
  const rows = filteredRows();
  const top = DATA.rows.slice(0, 5);
  const topImplied = DATA.rows[0];
  const missed = DATA.rows.filter((r) => !r.watchlist).sort((a, b) => b.tvl_usd - a.tvl_usd)[0];
  const calib = DATA.calibration;
  main.innerHTML = `<div class="shell">
    <header class="top">
      <div class="brand"><span class="mark" aria-hidden="true"></span><span class="brand-name">Token Radar · ${esc(DATA.model_version)}</span></div>
      <div class="top-meta"><span>Snapshot ${esc(DATA.as_of)}</span><span>${esc(DATA.source)}</span><span>Model ${esc(DATA.model_version)}</span></div>
    </header>
    <section class="lede" aria-label="What this board is">
      <div>
        <h1>Every protocol with no token yet, ranked by what its launch would be worth.</h1>
        <p>DefiLlama's watchlist keeps <b>${DATA.watchlist_size} protocols</b> at or above <b>$50M TVL</b>. This radar keeps them all — and adds the <b>${DATA.early_size} the watchlist missed</b> that pass the same rule: no token recorded, and not a wrapped, staked or bridged product of a token that already trades. The biggest one the watchlist missed is <b>${esc(missed.name)}</b>, <b>${money(missed.tvl_usd)}</b> TVL, ranked <b>#${missed.rank}</b>. Every row carries an implied value and a farm plan. A protocol that records no token is said to record none, never that it has none.</p>
      </div>
      <div class="facts" aria-label="Facts">
        <div class="fact"><span>Protocols ranked</span><b>${DATA.board_size}</b></div>
        <div class="fact"><span>Watchlist covered</span><b>${DATA.watchlist_size} of ${DATA.watchlist_size}</b></div>
        <div class="fact"><span>Early radar (outside watchlist)</span><b>${DATA.early_size}</b></div>
        <div class="fact"><span>Already trading, set aside</span><b>${DATA.live_size}</b></div>
        <div class="fact"><span>Highest implied value</span><b>${money(topImplied.implied_value_usd)} · ${esc(topImplied.name)}</b></div>
        <div class="fact"><span>Market median FDV/TVL</span><b>${DATA.overall_multiple.toFixed(2)}×</b></div>
      </div>
    </section>
    <section class="spot" aria-label="Top five by implied value">
      ${top.map((r) => `<button class="spot-card" data-slug="${esc(r.slug)}"><span class="spot-rank">#${r.rank}</span><b>${esc(r.name)}</b><span class="num">${money(r.implied_value_usd)}</span><span class="sub">${money(r.tvl_usd)} TVL · ${r.multiple.toFixed(2)}× multiple</span></button>`).join('')}
    </section>
    <div class="controls">
      <div class="field"><label for="q">Search</label><input id="q" type="search" value="${esc(state.q)}" placeholder="Name, slug or category" autocomplete="off"></div>
      <div class="field"><label for="category">Category</label><select id="category"><option value="">All categories</option>${CATEGORIES.map((c) => `<option value="${esc(c)}" ${state.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="chain">Chain</label><select id="chain"><option value="">All chains</option>${CHAINS.map((c) => `<option value="${esc(c)}" ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="minTvl">Minimum TVL</label><select id="minTvl">${MIN_TVL.map(([v, l]) => `<option value="${v}" ${state.minTvl === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <label class="check"><input type="checkbox" id="watch" ${state.watch ? 'checked' : ''}> Watchlist only</label>
      <div class="tabs" role="group" aria-label="Board or live token view">
        <button data-tab="pre" aria-pressed="${state.tab === 'pre'}">Pre-token</button>
        <button data-tab="live" aria-pressed="${state.tab === 'live'}">Live token</button>
      </div>
      <span class="count" aria-live="polite">${state.tab === 'pre' ? `${rows.length} of ${DATA.board_size} rows` : `${DATA.live.length} live-token protocols`}</span>
    </div>
    ${state.tab === 'pre' ? `<div class="panel"><div class="table-wrap"><table>
      <caption class="sr-only" style="position:absolute;left:-9999px">Pre-token protocols ranked by implied value</caption>
      <thead><tr>${th('Rank', 'rank')}<th scope="col">Protocol</th>${th('TVL', 'tvl')}${th('7d change', 'change')}${th('Multiple', 'multiple')}${th('Implied value', 'implied')}<th scope="col">Status</th></tr></thead>
      <tbody>${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="7"><div class="empty"><h2>Nothing matches</h2><p>No protocol fits these filters. Clear the search or widen the filters.</p><button class="button" data-clear="1">Clear filters</button></div></td></tr>`}</tbody>
    </table></div></div>` : `<div class="panel"><div class="table-wrap"><table>
      <caption class="sr-only" style="position:absolute;left:-9999px">Live-token protocols by market cap</caption>
      <thead><tr><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d change</th><th scope="col">Market cap</th><th scope="col">FDV/TVL</th></tr></thead>
      <tbody>${DATA.live.map(liveHtml).join('')}</tbody>
    </table></div></div>
    <p class="note" style="margin-top:12px">These ${DATA.live.length} protocols already trade, so the board shows the market's own value for them instead of a model's. They are the comparables that set each category's multiple.</p>`}
    <section class="panel model" aria-label="How the model works">
      <h2>How the implied value is built</h2>
      <p>Implied value = TVL × category multiple × growth × maturity × chain spread. The category multiple is the median market-cap-per-TVL of the snapshot's own token-bearing protocols in that category, shrunk toward the whole-market median (${DATA.overall_multiple.toFixed(2)}×) where the category has few comparables, and clamped to [0.05, 2]. Growth is the 7-day TVL change, clamped to ±25% and weighted by ${DATA.model.growth_weight}. Maturity rises from ${DATA.model.maturity_floor} at listing to 1.00 over ${DATA.model.maturity_days} days; a protocol with no listing date is given ${DATA.model.unknown_age_days} days. Each extra chain adds ${DATA.model.chain_bonus * 100}% (at most ${DATA.model.chain_bonus_max} chains). No protocol name is special-cased: the same function scores every row.</p>
      <div class="formula">implied = tvl_usd × multiple × (1 + clamp(change_7d, -25, +25) / 100 × 0.5)<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;× (0.7 + min(age_days, 1095) / 1095 × 0.3) × (1 + 0.02 × min(chains - 1, 4))</div>
      <table class="calib"><caption class="sr-only">Category multiples</caption><thead><tr><th scope="col">Category</th><th scope="col">Comparables</th><th scope="col">Median FDV/TVL</th><th scope="col">Multiple used</th></tr></thead>
      <tbody>${calib.map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.comparables}</td><td class="num">${c.median_multiple === null ? '—' : `${c.median_multiple.toFixed(2)}×`}</td><td class="num">${c.multiple.toFixed(2)}×</td></tr>`).join('')}</tbody></table>
      <p class="note">A multiple above 1 means the category's tokens trade above their TVL; a multiple below 0.2 means they trade thinly. The board is a radar, not a promise: implied value is a model's estimate of what a launch could be worth, not a price, and a launch may never happen.</p>
    </section>
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
  const growth = row.change_7d === null ? 0 : Math.min(25, Math.max(-25, row.change_7d));
  const age = row.age_days === null ? DATA.model.unknown_age_days : row.age_days;
  const maturityMult = DATA.model.maturity_floor + (Math.min(age, DATA.model.maturity_days) / DATA.model.maturity_days) * DATA.model.maturity_range;
  const chainMult = 1 + DATA.model.chain_bonus * Math.min(Math.max(row.chains.length - 1, 0), DATA.model.chain_bonus_max);
  const calib = DATA.calibration.find((c) => c.category === (row.category || 'Other'));
  const comps = DATA.live.filter((l) => l.category === row.category).slice(0, 5);
  const steps = farmSteps(row);
  dlg.innerHTML = `<div class="detail-head"><div><span class="badge ${row.watchlist ? 'watch' : ''}">#${row.rank} · ${row.watchlist ? 'Watchlist' : 'Early radar'}</span><h2>${esc(row.name)}</h2><p class="sub">${esc(row.category || 'Uncategorized')} · ${esc(row.chains.join(', ') || 'no chain listed')} · ${ageText(row.age_days)} · ${money(row.tvl_usd)} TVL</p></div><button class="close" data-close="1" aria-label="Close detail">Close ×</button></div>
  <section class="detail-section"><h3>Why it ranks #${row.rank}</h3>
    <div class="equation">
      <div><span>TVL</span><b>${moneyExact(row.tvl_usd)}</b></div>
      <div><span>Category multiple (${esc(row.category || 'Other')})</span><b>${row.multiple.toFixed(2)}×</b></div>
      <div><span>Growth (7d ${changeText(row.change_7d)})</span><b>× ${row.growth_multiplier.toFixed(3)}</b></div>
      <div><span>Maturity (${ageText(row.age_days)})</span><b>× ${maturityMult.toFixed(3)}</b></div>
      <div><span>Chain spread (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'})</span><b>× ${chainMult.toFixed(3)}</b></div>
      <div class="total"><span>Implied value</span><b>${moneyExact(row.implied_value_usd)}</b></div>
    </div>
    <p>${esc(row.name)} ranks #${row.rank} because it holds ${money(row.tvl_usd)} of TVL in ${esc(row.category || 'an uncategorized')} category, whose tokens trade at ${row.multiple.toFixed(2)}× TVL, and it has been live ${ageText(row.age_days)}. Its 7-day change is ${changeText(row.change_7d)}. The implied value is a model's estimate, not a price, and the launch may never happen.</p>
    ${calib ? `<p>Category multiple: ${calib.comparables} comparable${calib.comparables === 1 ? '' : 's'} in ${esc(calib.category)}, median FDV/TVL ${calib.median_multiple === null ? '—' : `${calib.median_multiple.toFixed(2)}×`}, shrunk toward the market median ${DATA.overall_multiple.toFixed(2)}×.</p>` : ''}
  </section>
  ${comps.length ? `<section class="detail-section"><h3>Comparable tokens in ${esc(row.category || 'this category')}</h3><div class="comps">${comps.map((c) => `<div class="comp"><span>${esc(c.name)}</span><b class="num">${c.fdv_tvl === null ? '—' : `${c.fdv_tvl.toFixed(2)}×`} FDV/TVL · ${money(c.tvl_usd)} TVL</b></div>`).join('')}</div></section>` : ''}
  <section class="detail-section"><h3>Farm plan</h3>
    <ol class="steps">${steps.map((s) => {
      const match = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.$/);
      if (!match) return `<li>${esc(s)}</li>`;
      return `<li><b>${esc(match[1])}</b><span class="cost">Cost: ${esc(match[2])} · Time: ${esc(match[3])}</span></li>`;
    }).join('')}</ol>
    <p>Seven steps, each with a cost and a time. The plan is derived from this protocol's own record — its category, its chain and its TVL — and it is the same plan the board file carries.</p>
  </section>`;
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
