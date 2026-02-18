const assert = require('assert');
const { placeOrder } = require('./bithumb_client');

(async () => {
  // Dry-run should simulate and never live-trade
  delete process.env.LIVE_MODE;
  const dry = await placeOrder({ symbol: 'BTC_KRW', side: 'buy', price: 1000, quantity: 0.01 });
  assert.strictEqual(dry.ok, true);
  assert.strictEqual(dry.dry, true);

  // Live mode path must be blocked by default client safety guard
  process.env.LIVE_MODE = 'true';
  process.env.BITHUMB_API_KEY = process.env.BITHUMB_API_KEY || 'dummy';
  process.env.BITHUMB_API_SECRET = process.env.BITHUMB_API_SECRET || 'dummy';

  let blocked = false;
  try {
    await placeOrder({ symbol: 'BTC_KRW', side: 'buy', price: 1000, quantity: 0.01 });
  } catch (e) {
    blocked = /blocked/i.test(String(e.message || ''));
  }
  assert.strictEqual(blocked, true, 'live trading path should stay blocked by safety guard');

  console.log('safety_test passed');
})();
