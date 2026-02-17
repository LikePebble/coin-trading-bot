// Minimal Bithumb REST client scaffold (Node.js)
// WARNING: This is a scaffold. Do not run live trades without configuring credentials and dry-run checks.

const fetch = require('node-fetch');
const crypto = require('crypto');

const API_BASE = 'https://api.bithumb.com';

function now() { return Math.floor(Date.now() / 1000); }

function buildSignature(endpoint, params, apiSecret) {
  // Placeholder: Bithumb uses api-key + signature (HMAC) in headers for private endpoints.
  const message = endpoint + '\0' + JSON.stringify(params) + '\0' + now();
  return crypto.createHmac('sha512', apiSecret).update(message).digest('hex');
}

async function publicGet(path) {
  const res = await fetch(API_BASE + path);
  return res.json();
}

async function privatePost(path, body, apiKey, apiSecret) {
  const endpoint = path;
  const signature = buildSignature(endpoint, body, apiSecret);
  const headers = {
    'Api-Key': apiKey,
    'Api-Sign': signature,
    'Content-Type': 'application/json',
  };
  const res = await fetch(API_BASE + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return res.json();
}

module.exports = { publicGet, privatePost };
