// Token Radar radar-3: the in-page model. Every fitted number comes from window.RADAR
// (DATA.curve / DATA.model), which the program computed at build time; nothing here is
// hand-typed. app.js calls these, so the page, the board and the code agree.
// Note: DATA.curve.residual_std is rounded to 4 decimals, so band() differs from the
// stored p25_usd/p75_usd by ~0.002% — invisible at the compact money the page shows.
'use strict';
window.RADAR_MODEL = (() => {
  const D = () => window.RADAR;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
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
  /** Farm economics for a ticket: slice of a 10% airdrop, pro-rata by ticket over TVL,
      net of the row's build-time fees; verdict by the stated rule. */
  function farmEV(row, implied) {
    const slice = Math.round(implied * 0.1 * (row.farm.ticket_usd / row.tvl_usd) * 100) / 100;
    const fees = row.farm.fees_usd;
    const net = Math.round((slice - fees) * 100) / 100;
    const verdict = net > 0 && slice >= 2 * fees ? 'FARM' : net > 0 ? 'THIN' : 'SKIP';
    return { ticket_usd: row.farm.ticket_usd, slice_usd: slice, fees_usd: fees, hours: row.farm.hours, net_usd: net, verdict };
  }
  return { impliedValue, band, farmEV };
})();
