// Token Radar radar-4: the in-page model. Every fitted number comes from window.RADAR
// (DATA.curve / DATA.model), which the program computed at build time; nothing here is
// hand-typed. app.js calls these, so the page, the board and the code agree.
// curve.residual_std is stored at full precision, so band() agrees with the stored
// p25_usd/p75_usd to the dollar.
'use strict';
window.RADAR_MODEL = (() => {
  const D = () => window.RADAR;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const r2 = (v) => Math.round(v * 100) / 100;
  /** Implied value from the snapshot figures, recomputed in the page. */
  function impliedValue(row) {
    const m = D().model;
    const growth = 1 + (clamp(row.change_7d ?? 0, m.growth_floor, m.growth_cap) / 100) * m.growth_weight;
    const age = row.age_days ?? m.unknown_age_days;
    const maturity = m.maturity_floor + (clamp(age, 0, m.maturity_days) / m.maturity_days) * m.maturity_range;
    const chain = 1 + m.chain_bonus * clamp(row.chains.length - 1, 0, m.chain_bonus_max);
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * growth * maturity * chain));
  }
  /** P25-P75 band: the central half of a log-normal residual distribution, 0.6745 sigma each way. */
  function band(implied) {
    const f = 10 ** (0.6745 * D().curve.residual_std);
    return { p25: Math.max(1, Math.round(implied / f)), p75: Math.max(1, Math.round(implied * f)) };
  }
  /** Farm economics, dollar-days slice (radar-4): a hold of H days stands behind
      min(H, age)/2 day-equivalents, so slice = implied x share x ticket x min(H, age)
      / (TVL x age). Net deducts gas fees AND the T-bill yield forgone on the ticket.
      opts: {ticket, share, tbill} — defaults are the row's build-time $1,000 / 10% / 4%. */
  function farmEV(row, implied, opts) {
    const o = opts || {};
    const ticket = o.ticket ?? row.farm.ticket_usd;
    const share = o.share ?? 0.1;
    const tbillRate = o.tbill ?? 0.04;
    const m = D().model;
    const age = row.age_days ?? m.unknown_age_days;
    const H = row.farm.farm_days;
    const held = Math.min(H, age);
    const sliceRaw = implied * share * ticket * held / (row.tvl_usd * age);
    const slice = r2(sliceRaw);
    const sliceSnap = r2(implied * share * ticket / row.tvl_usd);
    const fees = row.farm.fees_usd;
    const tbill = r2(ticket * tbillRate * H / 365);
    const total = r2(fees + tbill);
    const net = r2(slice - total);
    const perHour = r2(net / row.farm.hours);
    const be = sliceRaw > 0 ? Math.round((fees + tbill) / sliceRaw * 10000) / 10000 : null;
    const k = sliceRaw / ticket;
    const tb = tbillRate * H / 365;
    const pays = k > tb ? Math.max(1, Math.ceil(fees / (k - tb))) : null;
    const verdict = net > 0 && slice >= 2 * total ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
    return { ticket_usd: ticket, share, tbill_rate: tbillRate, farm_days: H, day_equivalents: held / 2, slice_usd: slice, slice_snapshot_usd: sliceSnap, fees_usd: fees, tbill_usd: tbill, total_cost_usd: total, hours: row.farm.hours, net_usd: net, per_hour_usd: perHour, breakeven_odds: be, pays_from_usd: pays, verdict };
  }
  return { impliedValue, band, farmEV };
})();
