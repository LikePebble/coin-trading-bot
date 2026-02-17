// Bithumb REST client with improved signing, retry, and safe-order helper
// WARNING: This is a developer scaffold. Do NOT execute live trades without proper credentials, testing, and explicit confirmation.

const fetch = require('node-fetch');
const crypto = require('crypto');
const qs = require('querystring');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');


const API_BASE = 'https://api.bithumb.com';

function nowMs() { return Date.now(); }

function buildSignature(endpoint, params, apiSecret) {
  // Bithumb uses a signature: HMAC-SHA512 of (endpoint + '\0' + qsString + '\0' + nonce)
  // Many implementations vary; adjust to the exchange's official formula when enabling live.
  const nonce = String(nowMs());
  const qsString = typeof params === 'string' ? params : qs.stringify(params || {});
  const message = endpoint + '\0' + qsString + '\0' + nonce;
  // Legacy API expects base64 HMAC signature in Api-Sign
  const hmac = crypto.createHmac('sha512', apiSecret).update(message).digest('base64');
  return { signature: hmac, nonce };
}

async function publicGet(path) {
  const res = await fetch(API_BASE + path);
  return res.json();
}

function buildJwtAuth(path, body, apiKey, apiSecret, opts = {}) {
  // Build JWT per doc: payload { access_key, nonce, timestamp }
  // If body or query params exist, compute query_hash (SHA512) per docs
  let queryHash = null;
  let queryHashAlg = null;
  let computedQs = '';
  try {
    if (body && Object.keys(body).length) {
      // Determine content type: prefer opts.contentType, then headers, else assume JSON
      const contentType = (opts.contentType || (opts.headers && opts.headers['Content-Type']) || '').toLowerCase();
      if (contentType.includes('application/json')) {
        // Canonicalize JSON: sort object keys recursively to produce deterministic string
        function canonicalize(obj) {
          if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
          const keys = Object.keys(obj).sort();
          const out = {};
          for (const k of keys) out[k] = canonicalize(obj[k]);
          return out;
        }
        const canon = canonicalize(body);
        computedQs = JSON.stringify(canon);
      } else {
        // Fallback to URL-encoded query string
        computedQs = qs.stringify(body);
      }
      if (computedQs) {
        const hash = crypto.createHash('sha512');
        hash.update(computedQs, 'utf-8');
        queryHash = hash.digest('hex');
        queryHashAlg = 'SHA512';
      }
    }
  } catch (e) {
    if (opts.debug) console.warn('[DEBUG] query_hash compute failed', e.message || e);
  }

  const payload = { access_key: apiKey, nonce: uuidv4(), timestamp: Date.now() };
  if (queryHash) {
    payload.query_hash = queryHash;
    payload.query_hash_alg = queryHashAlg;
  }

  if (opts.debug) {
    console.log('[DEBUG] JWT payload:', {
      access_key: apiKey ? `${String(apiKey).slice(0, 6)}...` : '(missing)',
      nonce: payload.nonce,
      timestamp: payload.timestamp,
      query_hash: payload.query_hash || null,
      query_hash_alg: payload.query_hash_alg || null,
    });
    console.log('[DEBUG] JWT body qs:', computedQs || '');
  }

  const token = jwt.sign(payload, apiSecret);
  const headers = { Authorization: `Bearer ${token}` };
  if (opts.debug) console.log('[DEBUG] JWT auth headers:', { Authorization: `Bearer ${token.slice(0,8)}...` });

  return { payload, token, headers, computedQs };
}

async function privatePost(path, body, apiKey, apiSecret, opts = {}) {
  // Auto-select auth mode by endpoint unless caller explicitly sets opts.auth.
  // Legacy endpoints like /info/* require HMAC; JWT is for versioned endpoints (/v1/*, /v2/*).
  const isVersionedPath = /^\/v\d+\//.test(path || '');
  const useJwt = (opts.auth === 'jwt') || (opts.auth == null && isVersionedPath);

  if (useJwt) {
    const { headers } = buildJwtAuth(path, body, apiKey, apiSecret, opts);

    try {
      // choose method based on presence of body
      if (body && Object.keys(body).length) {
        const postHeaders = Object.assign({ 'Content-Type': (opts.contentType || 'application/json; charset=utf-8') }, headers);
        let data;
        if (opts.rawQs) {
          // caller provided raw QS string to be used for hashing and body posting
          data = opts.rawQs;
        } else if (postHeaders['Content-Type'].includes('application/json')) {
          data = JSON.stringify(body);
        } else {
          // form-encoded
          data = qs.stringify(body);
        }
        // If opts.forceRFC3986 or endpoint policy requires, provide raw RFC3986 QS as well
        if (opts.forceRFC3986) {
          const rfc3986 = (obj) => Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(obj[k]))).join('&');
          if (body && Object.keys(body).length) data = rfc3986(body);
        }
        const res = await axios.post(API_BASE + path, data, { headers: postHeaders, timeout: opts.timeout || 15000 });
        return res.data;
      } else {
        const res = await axios.get(API_BASE + path, { headers, timeout: opts.timeout || 15000 });
        return res.data;
      }
    } catch (err) {
      if (err.response) return err.response.data;
      throw err;
    }
  }

  // legacy HMAC path follows below

  // opts.retry: number of retries on network/5xx errors
  const endpoint = path;
  const bodyQs = qs.stringify(body || {});
  const { signature, nonce } = buildSignature(endpoint, body, apiSecret);
  const headers = {
    'Api-Key': apiKey,
    'Api-Sign': signature,
    'Api-Nonce': nonce,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // DEBUG: log header signature (without secret) and body for troubleshooting
  if (opts && opts.debug) {
    try {
      console.log('[DEBUG] Request to', API_BASE + path);
      console.log('[DEBUG] Headers (Api-Key shown, Api-Sign shown, Api-Nonce shown):', {
        'Api-Key': headers['Api-Key'],
        'Api-Sign': headers['Api-Sign'],
        'Api-Nonce': headers['Api-Nonce'],
      });
      console.log('[DEBUG] Body QS:', bodyQs);
    } catch (e) { /* ignore */ }
  }

  const maxRetries = (opts.retry || 2);
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetch(API_BASE + path, { method: 'POST', headers, body: bodyQs, timeout: opts.timeout || 15000 });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
      if (!res.ok && attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      return json;
    } catch (err) {
      if (attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      throw err;
    }
  }
}

// Safe order helper: dry-run, confirmation hook, retries, logging
async function safePlaceOrder({symbol, side, price, quantity, type='limit', apiKey, apiSecret, dryRun=true, confirmCallback=null, logFn=console.log}) {
  // symbol: e.g., 'BTC_KRW' depending on Bithumb naming
  const order = { symbol, side, price, quantity, type };
  logFn(`[safeOrder] prepared order: ${JSON.stringify(order)}`);

  if (dryRun) {
    logFn('[safeOrder] DRY-RUN enabled: no request sent');
    return { simulated: true, order };
  }

  // require explicit confirmation via callback
  if (typeof confirmCallback === 'function') {
    const ok = await confirmCallback(order);
    if (!ok) {
      logFn('[safeOrder] user cancelled order');
      return { cancelled: true };
    }
  } else {
    throw new Error('safePlaceOrder requires a confirmCallback when dryRun=false');
  }

  // place order
  const path = '/trade/place'; // placeholder endpoint; confirm with Bithumb docs
  const body = { order_currency: symbol.split('_')[0], payment_currency: symbol.split('_')[1] || 'KRW', side, price, quantity, type };

  const res = await privatePost(path, body, apiKey, apiSecret, { retry: 3, timeout: 20000 });
  logFn(`[safeOrder] place response: ${JSON.stringify(res)}`);
  return res;
}

module.exports = { publicGet, privatePost, safePlaceOrder, buildJwtAuth };
