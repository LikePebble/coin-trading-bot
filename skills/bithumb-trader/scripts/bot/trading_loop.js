const client = require('../api/bithumb_client_safe');
const { decideSignal } = require('./strategy_intraday_v1');
const { canTrade, calcQty } = require('./risk_engine');
const { audit } = require('./audit_logger');
const cfg = require('./config');
const { load, save } = require('./state_store');
const { isKilled } = require('./kill_switch');

async function fetchCandles(symbol, timeframe, lookback=200) {
  // Placeholder: replace with actual historical fetch (public API)
  // For now, throw to remind implementer
  throw new Error('fetchCandles not implemented; use exchange public API or cached CSV');
}

async function loopOnce(context) {
  if (isKilled(cfg)) { audit('kill', {reason:'file'}); return; }
  // load recent candles
  const candles5 = await fetchCandles(cfg.SYMBOL, cfg.TIMEFRAMES.signal, 120);
  const candles1h = await fetchCandles(cfg.SYMBOL, cfg.TIMEFRAMES.regime, 300);
  const signal = decideSignal(candles5, candles1h);
  audit('signal', signal.indicators);

  if (!signal.enter) return audit('no-entry', {});

  const state = load();
  const gate = canTrade({ dayPnlPct: state.dayPnlPct || 0, openPositions: state.positions || [], infra: state.infra || {} }, cfg);
  if (!gate.ok) return audit('blocked', gate);

  const equity = state.equity || 1000000; // placeholder; implement balance fetch
  const qty = calcQty({ equity, entry: signal.entry, stop: signal.stop, cfg });
  if (qty <= 0) return audit('blocked', { reason: 'qty_zero' });

  const liveApproved = process.env.EXECUTE_ORDER === '1' && !!process.env.LIVE_APPROVAL_TOKEN;
  const dryRun = !(liveApproved);

  audit('order_attempt', { symbol: cfg.SYMBOL, entry: signal.entry, qty, dryRun });

  const res = await client.safePlaceOrder({ symbol: cfg.SYMBOL, side: 'buy', price: String(signal.entry), quantity: String(qty), type: 'limit', apiKey: process.env.BITHUMB_API_KEY, apiSecret: process.env.BITHUMB_API_SECRET, dryRun, confirmCallback: async () => liveApproved, logFn: (m)=>audit('order_log', {m}) });

  audit('order_result', res);
}

module.exports = { loopOnce };
