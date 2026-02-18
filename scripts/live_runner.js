require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { fetchTicker, placeOrder, readEnv } = require('./bithumb_client');
const { sendTelegram } = require('./notify_telegram');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function nowIso(){ return new Date().toISOString().replace(/[:.]/g,'-'); }

function writeLog(obj){
  const fn = path.join(LOG_DIR, `live_run_${nowIso()}.json`);
  fs.writeFileSync(fn, JSON.stringify(obj, null, 2));
}

// Safety limits read from env (or defaults)
const LIMITS = {
  TOTAL_BUDGET: parseFloat(process.env.TOTAL_BUDGET || '10000000'),
  MAX_ORDER: parseFloat(process.env.MAX_ORDER || '1000000'),
  MAX_DAILY_ORDERS: parseInt(process.env.MAX_DAILY_ORDERS || '100',10),
  ALLOWED_SYMBOLS: (process.env.ALLOWED_SYMBOLS || 'BTC_KRW').split(','),
  END_TIME: process.env.RUN_END_TIME || '2026-02-28T23:59:00+09:00'
};

let state = { spent:0, ordersToday:0, history:[] };

async function runOnce({symbol='BTC_KRW', side='buy', amountKRW=10000}){
  if (!LIMITS.ALLOWED_SYMBOLS.includes(symbol)) throw new Error('Symbol not allowed');
  if (!['buy', 'sell'].includes(side)) throw new Error('Invalid side');
  if (!Number.isFinite(amountKRW) || amountKRW <= 0) throw new Error('Invalid amountKRW');
  if (amountKRW > LIMITS.MAX_ORDER) throw new Error('Order exceeds MAX_ORDER');
  const budgetImpact = side === 'buy' ? amountKRW : 0;
  if (state.spent + budgetImpact > LIMITS.TOTAL_BUDGET) throw new Error('Would exceed TOTAL_BUDGET');
  if (state.ordersToday >= LIMITS.MAX_DAILY_ORDERS) throw new Error('Daily order limit reached');

  const ticker = await fetchTicker(symbol);
  const price = parseFloat(ticker?.data?.closing_price || ticker?.data?.close || ticker?.data?.price || 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid ticker price');
  const quantity = +(amountKRW / price).toFixed(8);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid calculated quantity');

  const res = await placeOrder({symbol, side, price, quantity});
  const record = {ts: new Date().toISOString(), symbol, side, amountKRW, price, quantity, budgetImpact, res};
  state.spent += budgetImpact;
  state.ordersToday += 1;
  state.history.push(record);

  // log and notify
  writeLog(state);
  await sendTelegram(`Order attempted:\n${JSON.stringify(record, null, 2)}`);

  // after each order, evaluate PnL & stop conditions
  await evaluatePerformanceAndMaybeStop();

  return record;
}

async function estimatePortfolioKrw(){
  // TOTAL_BUDGET - spent + sum(holdings * currentPrice)
  const holdings = {};
  for(const r of state.history){
    if(r.side === 'buy') holdings[r.symbol] = (holdings[r.symbol]||0) + r.quantity;
    if(r.side === 'sell') holdings[r.symbol] = (holdings[r.symbol]||0) - r.quantity;
  }
  let added = 0;
  for(const sym of Object.keys(holdings)){
    try{
      const t = await fetchTicker(sym);
      const price = parseFloat(t?.data?.closing_price || t?.data?.close || 0);
      if(Number.isFinite(price)) added += holdings[sym]*price;
    }catch(e){ /* ignore */ }
  }
  return (LIMITS.TOTAL_BUDGET - state.spent) + added;
}

async function evaluatePerformanceAndMaybeStop(){
  const targetPct = parseFloat(process.env.TARGET_DAILY_RETURN || '0.05');
  const stopLossPct = parseFloat(process.env.STOP_LOSS_PCT || '-0.02');
  const start = LIMITS.TOTAL_BUDGET;
  const est = await estimatePortfolioKrw();
  const pct = (est - start)/start;
  // notify
  await sendTelegram(`Performance check: estKrw=${Math.round(est)}, pct=${(pct*100).toFixed(2)}%`);
  if(pct >= targetPct){
    await sendTelegram(`Daily target reached (${(pct*100).toFixed(2)}%). Pausing trading.`);
    process.exit(0);
  }
  if(pct <= stopLossPct){
    await sendTelegram(`Stop-loss triggered (${(pct*100).toFixed(2)}%). Pausing trading.`);
    process.exit(1);
  }
}

async function dryRunLoop(hours=6, intervalSec=60){
  const requestedEnd = Date.now() + hours*3600*1000;
  const hardEnd = new Date(LIMITS.END_TIME).getTime();
  const end = Number.isFinite(hardEnd) ? Math.min(requestedEnd, hardEnd) : requestedEnd;

  if (Date.now() >= end) {
    throw new Error('Run end time already passed; refusing to start loop');
  }

  await sendTelegram(`Starting dry-run live_runner for ${hours}h. Limits: ${JSON.stringify(LIMITS)}`);
  while(Date.now() < end){
    try{
      // Simple example strategy: if last price dipped by >0.2% vs previous fetch, buy a small amount
      const before = await fetchTicker('BTC_KRW');
      await new Promise(r => setTimeout(r, 5000));
      const after = await fetchTicker('BTC_KRW');
      const p1 = parseFloat(before.data.closing_price || before.data.close || 0);
      const p2 = parseFloat(after.data.closing_price || after.data.close || 0);
      const change = (p2 - p1)/p1;
      if (change <= -0.002){
        // dip detected -> attempt small buy
        const amt = Math.min(50000, LIMITS.MAX_ORDER, LIMITS.TOTAL_BUDGET - state.spent);
        if (amt > 1000) await runOnce({symbol:'BTC_KRW', side:'buy', amountKRW: amt});
      }
    }catch(err){
      console.error('run error', err.message);
      await sendTelegram(`run error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, intervalSec*1000));
  }
  // finished
  await sendTelegram(`Dry-run finished. Summary: ${JSON.stringify({spent: state.spent, orders: state.ordersToday})}`);
  writeLog(state);
}

if (require.main === module){
  // Startup safety: if LIVE_MODE requested but LIVE_TRADING_ENABLED not set, refuse to start silently.
  if (process.env.LIVE_MODE === 'true' && process.env.LIVE_TRADING_ENABLED !== 'true'){
    const msg = 'Refusing to start live_runner: LIVE_MODE=true requires LIVE_TRADING_ENABLED=true to actually enable trading. Set LIVE_TRADING_ENABLED=true to confirm live trading.';
    console.error(msg);
    sendTelegram(msg);
    process.exit(2);
  }

  const hours = parseFloat(process.env.DRY_RUN_HOURS || '6');
  dryRunLoop(hours, parseInt(process.env.DRY_RUN_INTERVAL_SEC || '60',10)).catch(err=>{
    console.error(err);
    sendTelegram('live_runner fatal: '+err.message);
  });
}

module.exports = { runOnce, dryRunLoop };
