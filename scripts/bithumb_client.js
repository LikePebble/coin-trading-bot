require('dotenv').config();
const axios = require('axios');

// Minimal safe Bithumb client wrapper for orders (dry-run by default)
// Uses env vars: BITHUMB_API_KEY, BITHUMB_API_SECRET

const BASE = 'https://api.bithumb.com';

function readEnv() {
  return {
    apiKey: process.env.BITHUMB_API_KEY,
    apiSecret: process.env.BITHUMB_API_SECRET,
    dryRun: process.env.LIVE_MODE !== 'true',
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === 'true',
    maxRetry: parseInt(process.env.BITHUMB_MAX_RETRY || '3', 10),
    retryDelayMs: parseInt(process.env.BITHUMB_RETRY_DELAY_MS || '500', 10),
  };
}

async function fetchTicker(symbol = 'BTC_KRW') {
  const url = `${BASE}/public/ticker/${symbol}`;
  const { data } = await axios.get(url);
  return data;
}

// Placeholder: sign and call private endpoints. We will NOT implement real order signing here to avoid accidental execution.
// Instead, provide a safe interface that either simulates (dry-run) or calls a supplied executor (if user wires securely).

async function placeOrder({symbol='BTC_KRW', side='buy', price, quantity, options={}}) {
  const env = readEnv();

  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid quantity');
  if (!['buy', 'sell'].includes(side)) throw new Error('Invalid side');

  const meta = {symbol, side, price, quantity, dryRun: env.dryRun, ts: new Date().toISOString()};
  if (env.dryRun) {
    // simulate latency
    await new Promise(r => setTimeout(r, 200));
    return {ok:true, dry:true, orderId:`DRY-${Date.now()}`, meta};
  }

  // Live mode requires an explicit second safety switch.
  if (!env.liveTradingEnabled) {
    throw new Error('Live mode requested but LIVE_TRADING_ENABLED is not true');
  }

  // Live mode -- MUST have API credentials. We still perform minimal checks and throw if not present.
  if (!env.apiKey || !env.apiSecret) throw new Error('API credentials missing for live mode');

  // Real implementation should construct nonce, signature, and POST to /trade API.
  // For safety, we refuse to auto-implement signing here unless explicitly requested.
  throw new Error('Live trading is blocked in this client. Implement signing with explicit approval.');
}

module.exports = { fetchTicker, placeOrder, readEnv };
