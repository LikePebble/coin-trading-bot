// JWT capability test suite for Bithumb (safe)
// Runs a few read-only JWT endpoints to verify access and behavior.
// Usage:
// export BITHUMB_API_KEY=...; export BITHUMB_API_SECRET=...; node scripts/api/bithumb_jwt_suite.js

const client = require('./bithumb_client_safe');

async function run() {
  const apiKey = process.env.BITHUMB_API_KEY;
  const apiSecret = process.env.BITHUMB_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error('Missing env vars. Set BITHUMB_API_KEY and BITHUMB_API_SECRET.');
    process.exit(1);
  }

  console.log('1) JWT read: /v1/accounts (balances)');
  try {
    const res1 = await client.privatePost('/v1/accounts', {}, apiKey, apiSecret, { auth: 'jwt', debug: true });
    console.log('-> /v1/accounts response:', Array.isArray(res1) ? `OK (${res1.length} items)` : res1);
  } catch (e) { console.error('-> /v1/accounts failed:', e); }

  console.log('\n2) JWT read: /v1/orders (order history) - params: {limit: 5}');
  try {
    const params = { limit: 5 };
    const tries = [];

    // 1) form-encoded QS (qs.stringify)
    tries.push({ name: 'form-urlencoded (qs.stringify)', opts: { auth: 'jwt', debug: true, contentType: 'application/x-www-form-urlencoded' }, body: params });

    // 2) RFC3986-escaped QS
    const rfc3986 = (obj) => Object.keys(obj).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(obj[k]))).join('&');
    tries.push({ name: 'RFC3986 QS', opts: { auth: 'jwt', debug: true, contentType: 'application/x-www-form-urlencoded' }, body: { __raw_qs: rfc3986(params) } });

    // 3) canonical JSON (sorted keys) stringified
    tries.push({ name: 'canonical JSON', opts: { auth: 'jwt', debug: true, contentType: 'application/json' }, body: params });

    // 4) compact JSON (no spaces)
    tries.push({ name: 'compact JSON', opts: { auth: 'jwt', debug: true, contentType: 'application/json' }, body: params });

    // 5) array-style example (not relevant here but included for completeness)
    tries.push({ name: 'array-style QS', opts: { auth: 'jwt', debug: true, contentType: 'application/x-www-form-urlencoded' }, body: { 'limit[]': [5] } });

    for (const t of tries) {
      console.log(`\n-> Trying: ${t.name}`);
      try {
        // special-case raw qs
        if (t.body && t.body.__raw_qs) {
          const body = {}; // pass empty body but set opts.rawQs to be used by client
          const res = await client.privatePost('/v1/orders', body, apiKey, apiSecret, Object.assign({}, t.opts, { rawQs: t.body.__raw_qs, forceRFC3986: true }));
          console.log(`-> result for ${t.name}:`, res);
        } else {
          // If the try requests an explicit RFC3986 try, set flag
          const opts = Object.assign({}, t.opts);
          if (t.name.includes('RFC3986')) opts.forceRFC3986 = true;
          const res = await client.privatePost('/v1/orders', t.body, apiKey, apiSecret, opts);
          console.log(`-> result for ${t.name}:`, res);
        }
      } catch (e) {
        console.error(`-> error for ${t.name}:`, e);
      }
    }
  } catch (e) { console.error('-> /v1/orders failed overall:', e); }

  console.log('\n3) Dry-run safePlaceOrder (no live order)');
  try {
    const sim = await client.safePlaceOrder({ symbol: 'BTC_KRW', side: 'buy', price: '1000000', quantity: '0.0001', apiKey, apiSecret, dryRun: true });
    console.log('-> dry-run result:', sim);
  } catch (e) { console.error('-> dry-run failed:', e); }

  console.log('\nSuite complete. If any JWT call failed with invalid key, re-check key/permissions/IP whitelist.');
}

run();
