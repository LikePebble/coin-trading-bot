function canTrade(ctx, cfg) {
  const { KILL_SWITCH_FILE } = cfg.SAFETY;
  const infra = ctx.infra || {};
  if (infra.killSwitch) return { ok: false, reason: 'kill_switch' };
  if (ctx.dayPnlPct <= -cfg.RISK.MAX_DAILY_LOSS_PCT) return { ok: false, reason: 'daily_loss_limit' };
  if ((infra.consecutiveErrors || 0) >= (cfg.RISK.MAX_CONSECUTIVE_ERRORS || 3)) return { ok: false, reason: 'circuit_breaker' };
  if ((ctx.openPositions || []).length >= cfg.RISK.MAX_CONCURRENT_POSITIONS) return { ok: false, reason: 'max_positions' };
  return { ok: true };
}

function calcQty({ equity, entry, stop, cfg }) {
  const riskKRW = equity * cfg.RISK.RISK_PER_TRADE_PCT;
  const stopDist = Math.max(Math.abs(entry - stop), 1);
  const rawQty = riskKRW / stopDist;
  const maxQtyByExposure = (equity * cfg.RISK.MAX_EXPOSURE_PCT) / entry;
  return Math.max(0, Math.min(rawQty, maxQtyByExposure));
}

module.exports = { canTrade, calcQty };
