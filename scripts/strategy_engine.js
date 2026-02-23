/**
 * Strategy Engine — Aggressive BTC Momentum Scalper
 * 
 * Multi-signal entry/exit with trailing stops, fee-aware PnL,
 * existing holdings integration, and real-time position management.
 *
 * Designed for Bithumb KRW-BTC with 0.04% trading fee.
 */

require('dotenv').config();
const { fetchTicker, executeSignedOrder, getOrderByUuid, privateRequest, readEnv, normalizeMarketSymbol } = require('./bithumb_client');
const { sendTelegram, flushTelegramQueue } = require('./notify_telegram');
const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────
const CONFIG = {
  SYMBOL: 'BTC_KRW',
  MARKET: 'KRW-BTC',
  FEE_RATE: 0.0004,              // 0.04% per trade
  POLL_INTERVAL_SEC: 10,          // price poll interval
  CANDLE_WINDOW: 60,              // number of price samples to keep (10s × 60 = 10min window)

  // ── Indicators ──
  EMA_FAST: 5,                    // fast EMA period
  EMA_SLOW: 20,                   // slow EMA period
  RSI_PERIOD: 14,                 // RSI lookback
  VOLUME_SPIKE_MULT: 1.5,         // volume spike threshold vs avg

  // ── Entry Conditions ──
  RSI_OVERSOLD: 30,               // aggressive buy on oversold
  RSI_OVERBOUGHT: 70,             // avoid buying when overbought
  DIP_THRESHOLD: -0.003,          // -0.3% dip in short window → buy signal
  MOMENTUM_THRESHOLD: 0.002,      // +0.2% momentum for trend-following entry

  // ── Exit Conditions ──
  TAKE_PROFIT_PCT: 0.015,         // +1.5% take-profit (before fees: net ~1.42%)
  STOP_LOSS_PCT: -0.01,           // -1.0% stop-loss (after fees: net ~-1.08%)
  TRAILING_STOP_PCT: 0.008,       // 0.8% trailing stop from peak
  PARTIAL_EXIT_PCT: 0.5,          // sell 50% at take-profit, trail rest

  // ── Position Sizing ──
  MAX_POSITION_PCT: 0.50,         // max 50% of portfolio in one position
  MIN_ORDER_KRW: 5000,            // exchange minimum
  MAX_ORDER_KRW: 1000000,         // safety cap per order
  SCALE_IN_ENABLED: true,         // allow adding to winning position
  SCALE_IN_THRESHOLD: 0.005,      // add more if up +0.5% and signal strong

  // ── Risk Management ──
  DAILY_TARGET_PCT: 0.05,         // +5% daily target → pause
  DAILY_STOP_LOSS_PCT: -0.02,     // -2% daily stop → halt
  MAX_CONSECUTIVE_LOSSES: 3,      // halt after 3 consecutive losses
  COOLDOWN_AFTER_LOSS_SEC: 120,   // 2min cooldown after a loss

  // ── Runtime ──
  RUN_HOURS: parseFloat(process.env.DRY_RUN_HOURS || '24'),
  LOG_DIR: path.join(__dirname, '..', 'logs'),
};

// ─── State ───────────────────────────────────────────────────
const state = {
  prices: [],                     // {ts, price, volume} ring buffer
  positions: [],                  // {id, symbol, side:'long', entryPrice, quantity, entryTs, peakPrice, partialExited}
  closedTrades: [],               // completed trades for PnL tracking
  startingBalanceKrw: 0,          // total portfolio value at start
  currentBalanceKrw: 0,
  consecutiveLosses: 0,
  lastLossTs: 0,
  dailyPnlKrw: 0,
  dailyPnlPct: 0,
  orderCount: 0,
  startTs: Date.now(),
};

// ─── Utility ─────────────────────────────────────────────────
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function ensureLogDir() {
  if (!fs.existsSync(CONFIG.LOG_DIR)) fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
}

function writeState() {
  ensureLogDir();
  const fn = path.join(CONFIG.LOG_DIR, 'strategy_state.json');
  fs.writeFileSync(fn, JSON.stringify(state, null, 2));
}

function fmtKrw(n) { return '₩' + Math.round(n).toLocaleString(); }
function fmtPct(n) { return (n * 100).toFixed(2) + '%'; }
function fmtBtc(n) { return n.toFixed(8); }
// notify with short-term dedupe to avoid rapid duplicate Telegram messages
const _recentNotifies = new Map(); // msg -> ts
const NOTIFY_DEDUPE_MS = 60 * 1000;
function notify(msg, options = {}) {
  try {
    const now = Date.now();
    const key = String(msg || '');
    const last = _recentNotifies.get(key);
    if (last && (now - last) < NOTIFY_DEDUPE_MS && !options.force) {
      log('notify suppressed duplicate: ' + (key.length>80? key.slice(0,80)+'...': key));
      return;
    }
    _recentNotifies.set(key, now);
    // prune
    for (const [k,v] of _recentNotifies.entries()) if (now - v > NOTIFY_DEDUPE_MS*5) _recentNotifies.delete(k);
    sendTelegram(msg, options).catch(err => log(`Notify queue error: ${err.message}`));
  } catch (e) {
    log('notify exception: ' + (e && e.message));
  }
}


// ─── Technical Indicators ────────────────────────────────────
function calcEMA(data, period) {
  if (data.length < period) return null;
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(data, period) {
  if (data.length < period + 1) return 50; // neutral default
  const changes = [];
  for (let i = data.length - period; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }
  let gains = 0, losses = 0;
  for (const c of changes) {
    if (c > 0) gains += c;
    else losses -= c;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - (100 / (1 + rs));
}

function getIndicators() {
  const prices = state.prices.map(p => p.price);
  if (prices.length < CONFIG.EMA_SLOW + 1) return null;

  const emaFast = calcEMA(prices, CONFIG.EMA_FAST);
  const emaFastPrev = calcEMA(prices.slice(0, -1), CONFIG.EMA_FAST);
  const emaSlow = calcEMA(prices, CONFIG.EMA_SLOW);
  const emaSlowPrev = calcEMA(prices.slice(0, -1), CONFIG.EMA_SLOW);
  const rsi = calcRSI(prices, CONFIG.RSI_PERIOD);

  // Short-term momentum (last 3 samples)
  const recent = prices.slice(-3);
  const shortMomentum = recent.length >= 2 ? (recent[recent.length - 1] - recent[0]) / recent[0] : 0;

  // Medium-term momentum (last 10 samples = ~100s)
  const medium = prices.slice(-10);
  const medMomentum = medium.length >= 2 ? (medium[medium.length - 1] - medium[0]) / medium[0] : 0;

  // Volume analysis
  const volumes = state.prices.map(p => p.volume).filter(v => v > 0);
  const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  const lastVolume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
  const volumeSpike = avgVolume > 0 ? lastVolume / avgVolume : 1;

  // EMA crossover detection
  const crossUp = emaFastPrev !== null && emaSlowPrev !== null && emaFastPrev <= emaSlowPrev && emaFast > emaSlow;
  const crossDown = emaFastPrev !== null && emaSlowPrev !== null && emaFastPrev >= emaSlowPrev && emaFast < emaSlow;
  const trendUp = emaFast > emaSlow;

  return {
    emaFast, emaSlow, rsi,
    shortMomentum, medMomentum,
    volumeSpike, avgVolume, lastVolume,
    crossUp, crossDown, trendUp,
    currentPrice: prices[prices.length - 1],
  };
}

// ─── Signal Generation ───────────────────────────────────────
function generateSignal(indicators) {
  if (!indicators) return { action: 'HOLD', reason: 'Insufficient data', strength: 0 };

  const { rsi, crossUp, crossDown, trendUp, shortMomentum, medMomentum, volumeSpike, currentPrice } = indicators;
  let buyScore = 0;
  let sellScore = 0;
  const reasons = [];

  // ── Buy signals ──
  if (crossUp) { buyScore += 3; reasons.push('EMA crossover ↑'); }
  if (rsi < CONFIG.RSI_OVERSOLD) { buyScore += 3; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); }
  if (rsi < 40 && rsi >= CONFIG.RSI_OVERSOLD) { buyScore += 1; reasons.push(`RSI low (${rsi.toFixed(1)})`); }
  if (shortMomentum <= CONFIG.DIP_THRESHOLD) { buyScore += 2; reasons.push(`Dip detected (${fmtPct(shortMomentum)})`); }
  if (medMomentum > CONFIG.MOMENTUM_THRESHOLD && trendUp) { buyScore += 2; reasons.push('Momentum ↑ + trend ↑'); }
  if (volumeSpike >= CONFIG.VOLUME_SPIKE_MULT) { buyScore += 1; reasons.push(`Volume spike (${volumeSpike.toFixed(1)}x)`); }

  // ── Sell signals (for existing positions) ──
  if (crossDown) { sellScore += 3; reasons.push('EMA crossover ↓'); }
  if (rsi > CONFIG.RSI_OVERBOUGHT) { sellScore += 2; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); }
  if (shortMomentum > 0.005 && rsi > 65) { sellScore += 1; reasons.push('Overextended'); }

  // ── Anti-signals (reduce buy score) ──
  if (rsi > CONFIG.RSI_OVERBOUGHT) { buyScore -= 2; }
  if (!trendUp && !crossUp && shortMomentum > 0) { buyScore -= 1; }

  if (buyScore >= 3) return { action: 'BUY', reason: reasons.join(' | '), strength: buyScore };
  if (sellScore >= 3) return { action: 'SIGNAL_SELL', reason: reasons.join(' | '), strength: sellScore };
  return { action: 'HOLD', reason: reasons.join(' | ') || 'No clear signal', strength: 0 };
}

// ─── Account & Position Management ──────────────────────────
async function loadAccountPositions() {
  const env = readEnv();
  try {
    const accounts = await privateRequest({
      method: 'GET', path: '/v1/accounts', params: {},
      env: { apiKey: process.env.BITHUMB_API_KEY, apiSecret: process.env.BITHUMB_API_SECRET },
      timeoutMs: 10000,
    });

    let totalKrw = 0;
    for (const acc of accounts) {
      if (acc.currency === 'KRW') {
        totalKrw += parseFloat(acc.balance);
      }
      if (acc.currency === 'BTC' && parseFloat(acc.balance) > 0) {
        const qty = parseFloat(acc.balance);
        const avgPrice = parseFloat(acc.avg_buy_price) || 0;
        // Register existing BTC as an open position
        state.positions.push({
          id: `EXISTING-BTC-${Date.now()}`,
          symbol: CONFIG.SYMBOL,
          side: 'long',
          entryPrice: avgPrice,
          quantity: qty,
          entryTs: Date.now(),
          peakPrice: avgPrice,
          partialExited: false,
          source: 'existing',
        });
        const ticker = await fetchTicker(CONFIG.SYMBOL);
        const curPrice = parseFloat(ticker?.data?.closing_price || 0);
        totalKrw += qty * curPrice;
        log(`Loaded existing BTC position: ${fmtBtc(qty)} @ avg ${fmtKrw(avgPrice)}, current ${fmtKrw(curPrice)}`);
      } else if (acc.currency !== 'KRW' && acc.currency !== 'P' && parseFloat(acc.balance) > 0) {
        // Other coins - estimate value
        try {
          const t = await fetchTicker(`${acc.currency}_KRW`);
          const p = parseFloat(t?.data?.closing_price || 0);
          totalKrw += parseFloat(acc.balance) * p;
        } catch (e) { /* skip */ }
      }
    }

    state.startingBalanceKrw = totalKrw;
    state.currentBalanceKrw = totalKrw;
    log(`Portfolio loaded: ${fmtKrw(totalKrw)}`);
    return accounts;
  } catch (e) {
    log(`Failed to load account: ${e.message}`);
    throw e;
  }
}

async function getAvailableKrw() {
  // Fetch actual KRW balance from exchange (not estimated)
  try {
    const accounts = await privateRequest({
      method: 'GET', path: '/v1/accounts', params: {},
      env: { apiKey: process.env.BITHUMB_API_KEY, apiSecret: process.env.BITHUMB_API_SECRET },
      timeoutMs: 10000,
    });
    const krwAcc = accounts.find(a => a.currency === 'KRW');
    const available = krwAcc ? parseFloat(krwAcc.balance) - parseFloat(krwAcc.locked || '0') : 0;
    return Math.max(0, available);
  } catch (e) {
    log(`Failed to fetch KRW balance: ${e.response?.data?.error?.message || e.message}`);
    return 0;
  }
}

function calcPositionSize(price, availableKrw) {
  const maxByPct = state.currentBalanceKrw * CONFIG.MAX_POSITION_PCT;
  const orderKrw = Math.min(availableKrw, maxByPct, CONFIG.MAX_ORDER_KRW);
  if (orderKrw < CONFIG.MIN_ORDER_KRW) return null;
  const quantity = Math.floor((orderKrw / price) * 1e8) / 1e8; // round down to 8 decimals
  const totalKrw = quantity * price;
  if (totalKrw < CONFIG.MIN_ORDER_KRW) return null;
  return { quantity, totalKrw };
}

// ─── Order Execution ─────────────────────────────────────────
async function executeBuy(price, sizing, signal) {
  const env = readEnv();
  const feeKrw = sizing.totalKrw * CONFIG.FEE_RATE;
  const effectiveEntry = price * (1 + CONFIG.FEE_RATE); // fee-adjusted entry

  log(`BUY signal (strength: ${signal.strength}): ${signal.reason}`);
  log(`Placing buy: ${fmtBtc(sizing.quantity)} @ ${fmtKrw(price)}, total ${fmtKrw(sizing.totalKrw)}, fee ${fmtKrw(feeKrw)}`);

  try {
    // Verify available KRW right before placing order to avoid "insufficient funds" 400
    const availKrw = await getAvailableKrw();
    if (sizing.totalKrw > availKrw) {
      log(`매수 스킵: 가용 KRW 부족(요청 ${fmtKrw(sizing.totalKrw)} > 가능 ${fmtKrw(availKrw)}) — 알림 생략`);
      return null;
    }

    let result;
    if (env.dryRun) {
      result = { uuid: `DRY-${Date.now()}`, side: 'bid', ord_type: 'limit', price: String(price), state: 'wait', volume: String(sizing.quantity) };
    } else {
      result = await executeSignedOrder({
        market: CONFIG.SYMBOL,
        side: 'bid',
        ord_type: 'limit',
        price: price,
        volume: sizing.quantity,
      });
    }

    const position = {
      id: result.uuid || `POS-${Date.now()}`,
      orderId: result.uuid,
      symbol: CONFIG.SYMBOL,
      side: 'long',
      entryPrice: effectiveEntry,
      rawEntryPrice: price,
      quantity: sizing.quantity,
      entryTs: Date.now(),
      peakPrice: price,
      partialExited: false,
      source: 'strategy',
      signal: signal.reason,
    };
    state.positions.push(position);
    state.orderCount++;

    const msg = `📈 매수 주문\n` +
      `수량: ${fmtBtc(sizing.quantity)} BTC\n` +
      `가격: ${fmtKrw(price)}\n` +
      `금액: ${fmtKrw(sizing.totalKrw)} (수수료 ${fmtKrw(feeKrw)})\n` +
      `신호: ${signal.reason}\n` +
      `주문ID: ${result.uuid || 'N/A'}`;
    notify(msg);
    writeState();
    return position;
  } catch (e) {
    const detail = e.response?.data?.error?.message || e.response?.data || e.message;
    const detailStr = typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
    // Suppress noisy "insufficient funds" notifications — log only
    if (/부족|insufficient/i.test(detailStr)) {
      log(`Buy failed (suppressed): ${detailStr}`);
    } else {
      log(`Buy failed: ${detailStr}`);
      notify(`❌ 매수 실패: ${detailStr}`, { dedupeKey: `buy_fail:${detailStr.slice(0,60)}` });
    }
    return null;
  }
}

async function executeSell(position, price, reason, portionPct = 1.0) {
  const env = readEnv();
  const sellQty = Math.floor(position.quantity * portionPct * 1e8) / 1e8;
  if (sellQty <= 0) return null;

  // Verify available BTC before placing sell
  try {
    const accounts = await privateRequest({
      method: 'GET', path: '/v1/accounts', params: {},
      env: { apiKey: process.env.BITHUMB_API_KEY, apiSecret: process.env.BITHUMB_API_SECRET },
      timeoutMs: 10000,
    });
    const btcAcc = accounts.find(a => a.currency === 'BTC');
    const availableBtc = btcAcc ? parseFloat(btcAcc.balance) - parseFloat(btcAcc.locked || '0') : 0;
    if (sellQty > availableBtc + 1e-10) {
      const now = Date.now();
      // Throttle duplicate alerts per position: 60s window
      if (!position._lastSellAlertTs || (now - position._lastSellAlertTs) > 60000) {
        position._lastSellAlertTs = now;
        const msg = `매도 중지: 가용 BTC 부족(요청 ${fmtBtc(sellQty)} > 가능 ${fmtBtc(availableBtc)})`;
        log(msg);
        notify(`❌ ${msg}`);
      } else {
        log(`Suppressed duplicate sell alert for ${position.id}`);
      }
      return null;
    }
  } catch (e) {
    log(`Failed to fetch BTC balance for sell: ${e.response?.data?.error?.message || e.message}`);
    notify(`⚠️ 매도 전 잔고 조회 실패: ${e.message}`);
    return null;
  }

  const grossKrw = sellQty * price;
  const feeKrw = grossKrw * CONFIG.FEE_RATE;
  const netKrw = grossKrw - feeKrw;
  const entryKrw = sellQty * (position.rawEntryPrice || position.entryPrice);
  const entryFee = entryKrw * CONFIG.FEE_RATE;
  const pnlKrw = netKrw - entryKrw - entryFee;
  const pnlPct = (pnlKrw / (entryKrw + entryFee));

  log(`SELL (${reason}): ${fmtBtc(sellQty)} @ ${fmtKrw(price)}, PnL ${fmtKrw(pnlKrw)} (${fmtPct(pnlPct)})`);

  try {
    let result;
    if (env.dryRun) {
      result = { uuid: `DRY-SELL-${Date.now()}`, side: 'ask', state: 'wait' };
    } else {
      result = await executeSignedOrder({
        market: CONFIG.SYMBOL,
        side: 'ask',
        ord_type: 'limit',
        price: price,
        volume: sellQty,
      });
    }

    // Update position
    position.quantity -= sellQty;
    if (portionPct < 1.0) {
      position.partialExited = true;
    }

    // Record closed trade
    const trade = {
      positionId: position.id,
      orderId: result.uuid,
      sellPrice: price,
      sellQty,
      entryPrice: position.rawEntryPrice || position.entryPrice,
      pnlKrw,
      pnlPct,
      reason,
      ts: Date.now(),
    };
    state.closedTrades.push(trade);
    state.dailyPnlKrw += pnlKrw;
    state.orderCount++;

    // Track consecutive losses
    if (pnlKrw < 0) {
      state.consecutiveLosses++;
      state.lastLossTs = Date.now();
    } else {
      state.consecutiveLosses = 0;
    }

    // Remove position if fully closed
    if (position.quantity <= 0.00000001) {
      state.positions = state.positions.filter(p => p.id !== position.id);
    }

    const emoji = pnlKrw >= 0 ? '📉✅' : '📉❌';
    const msg = `${emoji} 매도 완료\n` +
      `사유: ${reason}\n` +
      `수량: ${fmtBtc(sellQty)} BTC\n` +
      `매도가: ${fmtKrw(price)}\n` +
      `손익: ${fmtKrw(pnlKrw)} (${fmtPct(pnlPct)})\n` +
      `수수료: ${fmtKrw(feeKrw)}\n` +
      `주문ID: ${result.uuid || 'N/A'}`;
    notify(msg);
    writeState();
    return trade;
  } catch (e) {
    const detail = e.response?.data?.error?.message || e.response?.data || e.message;
    log(`Sell failed: ${detail}`);
    notify(`❌ 매도 실패: ${detail}`);
    return null;
  }
}

// ─── Position Monitor (Exit Logic) ──────────────────────────
async function checkExitConditions(currentPrice) {
  for (const pos of [...state.positions]) {
    if (pos.quantity <= 0.00000001) continue;

    const entryPrice = pos.rawEntryPrice || pos.entryPrice;
    const changePct = (currentPrice - entryPrice) / entryPrice;
    const feeAdjustedPct = changePct - (CONFIG.FEE_RATE * 2); // buy + sell fees

    // Update peak price for trailing
    if (currentPrice > pos.peakPrice) {
      pos.peakPrice = currentPrice;
    }
    const dropFromPeak = (currentPrice - pos.peakPrice) / pos.peakPrice;

    // ── Take Profit (partial) ──
    if (!pos.partialExited && feeAdjustedPct >= CONFIG.TAKE_PROFIT_PCT) {
      log(`Take-profit triggered for ${pos.id}: ${fmtPct(feeAdjustedPct)}`);
      await executeSell(pos, currentPrice, `익절 (${fmtPct(feeAdjustedPct)})`, CONFIG.PARTIAL_EXIT_PCT);
      continue;
    }

    // ── Trailing Stop (after partial or full) ──
    if (pos.partialExited && dropFromPeak <= -CONFIG.TRAILING_STOP_PCT) {
      log(`Trailing stop triggered for ${pos.id}: drop ${fmtPct(dropFromPeak)} from peak ${fmtKrw(pos.peakPrice)}`);
      await executeSell(pos, currentPrice, `트레일링 스탑 (고점 대비 ${fmtPct(dropFromPeak)})`, 1.0);
      continue;
    }

    // ── Stop Loss ──
    if (feeAdjustedPct <= CONFIG.STOP_LOSS_PCT) {
      log(`Stop-loss triggered for ${pos.id}: ${fmtPct(feeAdjustedPct)}`);
      await executeSell(pos, currentPrice, `손절 (${fmtPct(feeAdjustedPct)})`, 1.0);
      continue;
    }

    // ── Full trailing stop (no partial exit yet, but up significantly) ──
    if (!pos.partialExited && feeAdjustedPct > CONFIG.TAKE_PROFIT_PCT * 0.5 && dropFromPeak <= -CONFIG.TRAILING_STOP_PCT) {
      log(`Early trailing stop for ${pos.id}`);
      await executeSell(pos, currentPrice, `조기 트레일링 스탑 (${fmtPct(dropFromPeak)})`, 1.0);
      continue;
    }
  }
}

// ─── Scale-in Logic ──────────────────────────────────────────
async function checkScaleIn(currentPrice, signal) {
  if (!CONFIG.SCALE_IN_ENABLED) return;
  if (signal.action !== 'BUY' || signal.strength < 4) return;

  for (const pos of state.positions) {
    if (pos.source === 'existing') continue; // don't scale into existing
    const entryPrice = pos.rawEntryPrice || pos.entryPrice;
    const changePct = (currentPrice - entryPrice) / entryPrice;

    if (changePct >= CONFIG.SCALE_IN_THRESHOLD && !pos.scaledIn) {
      const availKrw = await getAvailableKrw();
      const sizing = calcPositionSize(currentPrice, availKrw);
      if (!sizing) continue;
      // Scale in with half size
      const scaleSize = { quantity: Math.floor(sizing.quantity * 0.5 * 1e8) / 1e8, totalKrw: sizing.totalKrw * 0.5 };
      if (scaleSize.totalKrw < CONFIG.MIN_ORDER_KRW) continue;

      log(`Scale-in: adding to position ${pos.id}, up ${fmtPct(changePct)}`);
      const newPos = await executeBuy(currentPrice, scaleSize, { ...signal, reason: `Scale-in: ${signal.reason}` });
      if (newPos) pos.scaledIn = true;
    }
  }
}

// ─── Daily Risk Checks ──────────────────────────────────────
async function checkDailyRisk() {
  // Estimate current portfolio value
  const ticker = await fetchTicker(CONFIG.SYMBOL);
  const curPrice = parseFloat(ticker?.data?.closing_price || 0);
  const positionValue = state.positions.reduce((sum, p) => sum + p.quantity * curPrice, 0);
  // Rough KRW balance = starting - invested + position value + realized PnL
  state.currentBalanceKrw = state.startingBalanceKrw + state.dailyPnlKrw;
  const pnlPct = state.startingBalanceKrw > 0 ? state.dailyPnlKrw / state.startingBalanceKrw : 0;
  state.dailyPnlPct = pnlPct;

  // Daily target — log only, do not stop
  if (pnlPct >= CONFIG.DAILY_TARGET_PCT) {
    notify(`🎯 일일 목표 도달! (${fmtPct(pnlPct)}) — 거래 계속 진행합니다.`, { dedupeKey: 'daily_target' });
  }

  // Daily stop-loss — log only, do not stop
  if (pnlPct <= CONFIG.DAILY_STOP_LOSS_PCT) {
    notify(`⚠️ 일일 손절 수준 도달 (${fmtPct(pnlPct)}) — 거래 계속 진행합니다.`, { dedupeKey: 'daily_stoploss' });
  }

  // Consecutive losses — log only, do not stop
  if (state.consecutiveLosses >= CONFIG.MAX_CONSECUTIVE_LOSSES) {
    notify(`⚠️ 연속 ${state.consecutiveLosses}회 손실 — 거래 계속 진행합니다.`, { dedupeKey: `consec_losses:${state.consecutiveLosses}` });
  }
}

// ─── Periodic Summary ────────────────────────────────────────
async function sendPeriodicSummary() {
  const elapsed = Math.round((Date.now() - state.startTs) / 60000);
  const ticker = await fetchTicker(CONFIG.SYMBOL);
  const curPrice = parseFloat(ticker?.data?.closing_price || 0);
  const openPositions = state.positions.filter(p => p.quantity > 0.00000001);
  const unrealizedPnl = openPositions.reduce((sum, p) => {
    const entry = p.rawEntryPrice || p.entryPrice;
    return sum + p.quantity * (curPrice - entry) - p.quantity * curPrice * CONFIG.FEE_RATE * 2;
  }, 0);

  const msg = `📊 ${elapsed}분 경과 요약\n` +
    `현재 BTC: ${fmtKrw(curPrice)}\n` +
    `실현 손익: ${fmtKrw(state.dailyPnlKrw)} (${fmtPct(state.dailyPnlPct)})\n` +
    `미실현 손익: ${fmtKrw(unrealizedPnl)}\n` +
    `오픈 포지션: ${openPositions.length}개\n` +
    `총 주문: ${state.orderCount}건\n` +
    `연속 손실: ${state.consecutiveLosses}회`;
  notify(msg, { dedupeKey: `periodic:${elapsed}` });
}

// ─── Main Loop ───────────────────────────────────────────────
async function mainLoop() {
  log('Strategy Engine starting...');
  ensureLogDir();

  // Auto-pair LIVE flags
  if (process.env.LIVE_MODE === 'true' && process.env.LIVE_TRADING_ENABLED !== 'true') {
    process.env.LIVE_TRADING_ENABLED = 'true';
    log('Auto-paired LIVE_TRADING_ENABLED');
  }

  const env = readEnv();
  const mode = env.dryRun ? 'DRY-RUN' : 'LIVE';
  notify(`🚀 전략 엔진 시작 (${mode})\n수수료: ${CONFIG.FEE_RATE * 100}%\n익절: ${fmtPct(CONFIG.TAKE_PROFIT_PCT)}\n손절: ${fmtPct(CONFIG.STOP_LOSS_PCT)}\n트레일링: ${fmtPct(CONFIG.TRAILING_STOP_PCT)}\n일일 목표: ${fmtPct(CONFIG.DAILY_TARGET_PCT)}\n일일 손절: ${fmtPct(CONFIG.DAILY_STOP_LOSS_PCT)}`, { dedupeKey: 'strategy_start' });

  // Load existing positions from account
  await loadAccountPositions();
  notify(`💰 시작 자산: ${fmtKrw(state.startingBalanceKrw)}\n보유 포지션: ${state.positions.length}개`, { dedupeKey: 'strategy_start_assets' });

  const endTime = Date.now() + CONFIG.RUN_HOURS * 3600 * 1000;
  let summaryCounter = 0;
  const SUMMARY_INTERVAL = 360; // every 360 polls (~1 hour at 10s interval)

  while (Date.now() < endTime) {
    try {
      // 1. Fetch current price
      const ticker = await fetchTicker(CONFIG.SYMBOL);
      const currentPrice = parseFloat(ticker?.data?.closing_price || 0);
      const volume = parseFloat(ticker?.data?.units_traded || 0);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        log('Invalid ticker, skipping...');
        await sleep(CONFIG.POLL_INTERVAL_SEC * 1000);
        continue;
      }

      // 2. Update price buffer
      state.prices.push({ ts: Date.now(), price: currentPrice, volume });
      if (state.prices.length > CONFIG.CANDLE_WINDOW) {
        state.prices = state.prices.slice(-CONFIG.CANDLE_WINDOW);
      }

      // 3. Calculate indicators
      const indicators = getIndicators();

      // 4. Check exit conditions for open positions
      await checkExitConditions(currentPrice);

      // 5. Generate signal
      const signal = generateSignal(indicators);

      // 6. Cooldown check
      const inCooldown = (Date.now() - state.lastLossTs) < CONFIG.COOLDOWN_AFTER_LOSS_SEC * 1000 && state.consecutiveLosses > 0;

      // 7. Execute entry if signal is strong enough
      if (signal.action === 'BUY' && !inCooldown) {
        // Prevent duplicate buys: skip if we already have an open strategy position
        const hasOpenPos = state.positions.some(p => p.source === 'strategy' && p.quantity > 0.00000001);
        if (hasOpenPos) {
          // Already in a position; skip new entry (scale-in handled separately)
        } else {
          const availKrw = await getAvailableKrw();
          const sizing = calcPositionSize(currentPrice, availKrw);
          if (sizing) {
            await executeBuy(currentPrice, sizing, signal);
          } else {
            log(`Buy signal but insufficient funds (available: ${fmtKrw(availKrw)}) or position limit reached`);
          }
        }
      }

      // 8. Scale-in check
      if (!inCooldown) {
        await checkScaleIn(currentPrice, signal);
      }

      // 9. Daily risk check
      await checkDailyRisk();

      // 10. Periodic summary
      summaryCounter++;
      if (summaryCounter >= SUMMARY_INTERVAL) {
        await sendPeriodicSummary();
        summaryCounter = 0;
      }

    } catch (err) {
      log(`Loop error: ${err.message}`);
      notify(`⚠️ 루프 오류: ${err.message}`);
    }

    await sleep(CONFIG.POLL_INTERVAL_SEC * 1000);
  }

  // Session ended
  await sendPeriodicSummary();
  notify('⏰ 전략 엔진 세션 종료 (시간 만료)');
  writeState();
  await flushTelegramQueue(5000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Entry Point ─────────────────────────────────────────────
if (require.main === module) {
  mainLoop().catch(async (err) => {
    console.error('Fatal:', err);
    notify(`💀 전략 엔진 치명적 오류: ${err.message}`, { critical: true });
    await flushTelegramQueue(5000);
    process.exit(1);
  });
}

module.exports = { mainLoop, CONFIG, state, generateSignal, getIndicators, calcEMA, calcRSI };
