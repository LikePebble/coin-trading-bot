require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

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

function base64UrlEncode(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return input
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildQueryString(payload = {}) {
  const entries = Object.entries(payload).filter(([, v]) => v !== undefined && v !== null);
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function signBithumbJwt({ apiKey, apiSecret, payload = {} }) {
  if (!apiKey || !apiSecret) throw new Error('Missing Bithumb API credentials');

  const nonce = crypto.randomUUID();
  const jwtPayload = {
    access_key: apiKey,
    nonce,
    timestamp: Date.now(),
  };

  const queryString = buildQueryString(payload);
  if (queryString) {
    jwtPayload.query_hash = crypto.createHash('sha512').update(queryString, 'utf8').digest('hex');
    jwtPayload.query_hash_alg = 'SHA512';
  }

  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(jwtPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', String(apiSecret))
    .update(signingInput, 'utf8')
    .digest();
  const encodedSignature = base64UrlEncode(signature);

  return {
    token: `${signingInput}.${encodedSignature}`,
    nonce,
    queryString,
  };
}

async function fetchTicker(symbol = 'BTC_KRW') {
  const url = `${BASE}/public/ticker/${symbol}`;
  const { data } = await axios.get(url);
  return data;
}

async function privateRequest({ method = 'GET', path, params = {}, env, timeoutMs = 10000 }) {
  const sanitizedMethod = method.toUpperCase();
  // Treat DELETE as a query-style request for signing and transmission (Bithumb expects query_hash over URL params)
  const isQueryStyle = sanitizedMethod === 'GET' || sanitizedMethod === 'DELETE';
  const { token } = signBithumbJwt({
    apiKey: env.apiKey,
    apiSecret: env.apiSecret,
    payload: params,
  });

  const config = {
    method: sanitizedMethod,
    url: `${BASE}${path}`,
    timeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (isQueryStyle) {
    // send params in URL query string so query_hash matches
    config.params = params;
  } else {
    config.data = params;
  }

  const { data } = await axios(config);
  return data;
}

async function placeOrder({ symbol = 'BTC_KRW', side = 'buy', price, quantity }) {
  const env = readEnv();

  if (!Number.isFinite(price) || price <= 0) throw new Error('Invalid price');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Invalid quantity');
  if (!['buy', 'sell'].includes(side)) throw new Error('Invalid side');

  if (process.env.LIVE_MODE === 'true' && process.env.LIVE_TRADING_ENABLED !== 'true') {
    throw new Error('Live trading blocked by safety guard (LIVE_TRADING_ENABLED not set)');
  }

  const meta = { symbol, side, price, quantity, dryRun: env.dryRun, ts: new Date().toISOString() };
  if (env.dryRun) {
    await new Promise((r) => setTimeout(r, 200));
    return { ok: true, dry: true, orderId: `DRY-${Date.now()}`, meta };
  }

  if (!env.liveTradingEnabled) {
    throw new Error('Live mode requested but LIVE_TRADING_ENABLED is not true');
  }

  if (!env.apiKey || !env.apiSecret) throw new Error('API credentials missing for live mode');

  throw new Error('Use executeSignedOrder for live signed execution.');
}

function normalizeMarketSymbol(market) {
  if (!market) return market;
  if (market.includes('_')) {
    const [base, quote] = market.split('_');
    return `${quote}-${base}`;
  }
  return market;
}

async function executeSignedOrder({ market = 'BTC_KRW', side = 'bid', ord_type = 'limit', price, volume, timeoutMs = 10000 }) {
  const env = readEnv();

  if (env.dryRun) {
    throw new Error('executeSignedOrder requires LIVE_MODE=true');
  }
  if (!env.liveTradingEnabled) {
    throw new Error('executeSignedOrder blocked: LIVE_TRADING_ENABLED is not true');
  }
  if (!env.apiKey || !env.apiSecret) {
    throw new Error('executeSignedOrder blocked: missing Bithumb API credentials');
  }

  if (!market || !side || !ord_type) throw new Error('Invalid order parameters');
  if (!price || Number(price) <= 0) throw new Error('Invalid price');
  if (!volume || Number(volume) <= 0) throw new Error('Invalid volume');

  const normalizedMarket = normalizeMarketSymbol(market);

  const payload = {
    market: normalizedMarket,
    side,
    volume: String(volume),
    price: String(price),
    ord_type,
  };

  const response = await privateRequest({
    method: 'POST',
    path: '/v1/orders',
    params: payload,
    env,
    timeoutMs,
  });

  return response;
}

async function getOrderByUuid({ uuid, timeoutMs = 10000 }) {
  const env = readEnv();
  if (!uuid) throw new Error('uuid is required');
  return privateRequest({
    method: 'GET',
    path: '/v1/order',
    params: { uuid },
    env,
    timeoutMs,
  });
}

module.exports = {
  fetchTicker,
  placeOrder,
  readEnv,
  signBithumbJwt,
  executeSignedOrder,
  getOrderByUuid,
  privateRequest,
  normalizeMarketSymbol,
};
