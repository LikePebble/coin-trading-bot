// Backtest runner (enhanced)
const fs = require('fs');
const path = require('path');
const parse = require('csv-parse/sync').parse;
const strategy = require('../bot/strategy_intraday_v1');
const {ensureDir, nowIso, saveJson} = require('./utils');

const DEFAULT_CONFIG = {
  symbol: 'BTC_KRW',
  fixtureFile: 'sample_5m_BTC_KRW.csv',
  initialEquity: 1000000,
  feePct: 0.0005,
  riskPct: 0.0025,
  atrStopMul: 1.2,
  atrTakeMul: 1.8,
  slippagePct: 0.0,
  debug: false
};

function loadPriceHistoryFromFile(fn) {
  if (!fs.existsSync(fn)) throw new Error('fixture not found: ' + fn);
  const raw = fs.readFileSync(fn, 'utf8');
  const rec = parse(raw, { columns: true, skip_empty_lines: true });
  return rec.map(r => ({ time: Number(r.time), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume) }));
}

function summarizeTrades(trades, equitySeries, startEquity) {
  const entries = trades.filter(t => t.type === 'entry');
  const exits = trades.filter(t => t.type === 'stop' || t.type === 'take');
  const wins = exits.filter(e => e.pnl > 0);
  const losses = exits.filter(e => e.pnl <= 0);
  const totalPnl = Math.round((equitySeries[equitySeries.length-1] - startEquity));

  // simple MDD calc
  let peak = startEquity; let mdd = 0;
  for (const v of equitySeries) {
    if (v > peak) peak = v;
    const dd = (peak - v);
    if (dd > mdd) mdd = dd;
  }

  const avgWin = wins.length ? (wins.reduce((s,x)=>s+x.pnl,0)/wins.length) : 0;
  const avgLoss = losses.length ? (losses.reduce((s,x)=>s+x.pnl,0)/losses.length) : 0;

  return {
    trades: trades.length,
    entries: entries.length,
    exits: exits.length,
    wins: wins.length,
    losses: losses.length,
    winRate: exits.length? (wins.length / exits.length) : null,
    totalPnl,
    finalEquity: equitySeries[equitySeries.length-1],
    avgWin,
    avgLoss,
    maxDrawdown: Math.round(mdd)
  };
}

function runStrategy(prices, config) {
  const trades = [];
  let position = null;
  let equity = config.initialEquity;
  const equitySeries = [equity];
  const feePct = config.feePct;

  const candles5 = prices;
  const candles1h = [];
  for (let i=0;i<candles5.length;i+=12) {
    const slice = candles5.slice(Math.max(0,i-11), i+1);
    const o = slice[0].open; const c = slice[slice.length-1].close;
    const h = Math.max(...slice.map(x=>x.high)); const l = Math.min(...slice.map(x=>x.low));
    candles1h.push({ time: slice[slice.length-1].time, open:o, high:h, low:l, close:c });
  }

  for (let i=50;i<candles5.length;i++) {
    const win5 = candles5.slice(Math.max(0,i-120), i+1);
    const idx1h = Math.floor(i/12);
    const win1h = candles1h.slice(Math.max(0, idx1h-300), idx1h+1);
    const sig = strategy.decideSignal(win5, win1h);
    let price = candles5[i].close;

    // apply slippage on fills
    const slippage = Math.abs(price) * (config.slippagePct || 0);

    if (config.debug) {
      if (sig.enter) console.log('[DEBUG] signal ENTER at', new Date(candles5[i].time*1000).toISOString(), 'price', price, 'indicators', sig.indicators);
      else {
        if (!sig.indicators.regimeBull) {/*console.log('[DEBUG] no entry - regime not bull at', new Date(candles5[i].time*1000).toISOString());*/}
      }
    }

    // check exit
    if (position) {
      if (price <= position.stop) {
        const exitPrice = price - slippage;
        const pnl = (position.qty * (position.entry - exitPrice));
        equity += pnl - Math.abs(position.entry*position.qty)*feePct;
        trades.push({ type:'stop', entry:position.entry, exit:exitPrice, pnl });
        position = null; equitySeries.push(equity); continue;
      }
      if (price >= position.take) {
        const exitPrice = price - slippage;
        const pnl = (position.qty * (position.take - position.entry));
        equity += pnl - Math.abs(position.entry*position.qty)*feePct;
        trades.push({ type:'take', entry:position.entry, exit:position.take, pnl });
        position = null; equitySeries.push(equity); continue;
      }
    }

    // entry
    if (!position && sig.enter) {
      const entry = price + slippage;
      const stop = sig.stop;
      const riskKRW = equity * config.riskPct;
      const qty = Math.max(0, Math.min((riskKRW / Math.max(1, entry - stop)), (equity*0.1)/entry));
      if (qty>0) {
        position = { entry, qty, stop: stop, take: sig.take, entryTime: candles5[i].time };
        trades.push({ type:'entry', entry, qty });
        equitySeries.push(equity);
      }
    }
  }

  return { trades, equitySeries, pnl: Math.round(equity - config.initialEquity), equity };
}

function loadConfig(cliConfigPath, overrides) {
  let cfg = Object.assign({}, DEFAULT_CONFIG);
  if (cliConfigPath && fs.existsSync(cliConfigPath)) {
    try { const c = JSON.parse(fs.readFileSync(cliConfigPath,'utf8')); cfg = Object.assign(cfg, c); } catch(e) { console.warn('failed reading config', e.message); }
  }
  if (overrides) cfg = Object.assign(cfg, overrides);
  return cfg;
}

function printSummary(summary) {
  console.log('\n=== BACKTEST SUMMARY ===');
  console.log('trades:', summary.trades, 'wins:', summary.wins, 'losses:', summary.losses, 'winRate:', summary.winRate);
  console.log('totalPnl:', summary.totalPnl, 'finalEquity:', summary.finalEquity, 'maxDrawdown:', summary.maxDrawdown);
}

function main() {
  const args = process.argv.slice(2);
  const cliConfigPath = args[0] && args[0].endsWith('.json') ? args[0] : null;
  const debug = args.includes('--debug');
  const cfg = loadConfig(cliConfigPath, { debug });

  const fixturesDir = path.resolve(__dirname, 'fixtures');
  const fn = path.resolve(fixturesDir, cfg.fixtureFile || (`sample_5m_${cfg.symbol}.csv`));
  const prices = loadPriceHistoryFromFile(fn);
  if (cfg.debug) console.log('[DEBUG] loaded prices count=', prices.length);

  const res = runStrategy(prices, cfg);
  const summary = summarizeTrades(res.trades, res.equitySeries, cfg.initialEquity);
  printSummary(summary);

  // persist results
  const resultsDir = path.resolve(__dirname, 'results');
  ensureDir(resultsDir);
  const out = { meta: { config: cfg, generatedAt: nowIso() }, summary, trades: res.trades };
  const outFile = path.resolve(resultsDir, `result_${cfg.symbol}_${nowIso().replace(/[:.]/g,'-')}.json`);
  saveJson(outFile, out);
  console.log('Saved results to', outFile);
}

if (require.main === module) main();

module.exports = { runStrategy, loadPriceHistoryFromFile };
