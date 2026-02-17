// Live auth test for Bithumb API (read-only test)
// Usage: set BITHUMB_API_KEY and BITHUMB_API_SECRET in the environment, then run:
//   node bithumb_live_test.js

const client = require('./bithumb_client_safe');

async function main() {
  const mock = process.argv.includes('--mock-debug');

  if (mock) {
    const fakeKey = 'demo-access-key';
    const fakeSecret = 'demo-secret-key';
    const jwtDebug = client.buildJwtAuth('/v1/accounts', {}, fakeKey, fakeSecret, { debug: true });
    console.log('--- MOCK JWT DEBUG (no network call) ---');
    console.log('Path:', '/v1/accounts');
    console.log('Headers:', { Authorization: `Bearer ${jwtDebug.token.slice(0, 16)}...` });
    console.log('Payload keys:', Object.keys(jwtDebug.payload));
    return;
  }

  const apiKey = process.env.BITHUMB_API_KEY;
  const apiSecret = process.env.BITHUMB_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error('Missing env vars. Please set BITHUMB_API_KEY and BITHUMB_API_SECRET in your environment.');
    console.error('Example (macOS/Linux): export BITHUMB_API_KEY=xxxx; export BITHUMB_API_SECRET=yyyy; node scripts/api/bithumb_live_test.js');
    process.exit(1);
  }

  try {
    console.log('Calling JWT account endpoint (read-only) to verify credentials...');
    const path = '/v1/accounts';
    const res = await client.privatePost(path, {}, apiKey, apiSecret, { auth: 'jwt', retry: 1, debug: true });
    console.log('Response:', res);
    console.log('If response contains account data, JWT auth succeeded.');
    console.log('Note: /info/balance is a legacy endpoint and typically requires HMAC auth, not JWT.');
  } catch (err) {
    console.error('Request failed:', err.message || err);
  }
}

if (require.main === module) main();
