// Demo: safe order pipeline
// Usage (dry-run):
// export BITHUMB_API_KEY=...; export BITHUMB_API_SECRET=...; node scripts/api/order_flow_demo.js
// To actually execute the order (requires explicit confirmation):
// export BITHUMB_API_KEY=...; export BITHUMB_API_SECRET=...; export EXECUTE_ORDER=1; node scripts/api/order_flow_demo.js

const client = require('./bithumb_client_safe');

async function promptConfirm() {
  // Non-interactive confirmation via env var only (safer for automated runs)
  return Boolean(process.env.EXECUTE_ORDER && process.env.EXECUTE_ORDER !== '0');
}

async function run() {
  const apiKey = process.env.BITHUMB_API_KEY;
  const apiSecret = process.env.BITHUMB_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error('Missing env vars. Set BITHUMB_API_KEY and BITHUMB_API_SECRET.');
    process.exit(1);
  }

  console.log('STEP 1 — Backtest/Simulate (placeholder)');
  // Placeholder: user should run actual backtest separately. We'll simulate a recommended order.
  const recommended = { symbol: 'BTC_KRW', side: 'buy', price: '1000000', quantity: '0.0001', type: 'limit' };
  console.log('[SIM] recommended order:', recommended);

  console.log('\nSTEP 2 — Dry-run (no request)');
  const dry = await client.safePlaceOrder({ ...recommended, apiKey, apiSecret, dryRun: true, logFn: console.log });
  console.log('Dry-run result:', dry);

  console.log('\nSTEP 3 — User confirmation required to execute live order');
  const confirmed = await promptConfirm();
  if (!confirmed) {
    console.log('Not confirmed. To execute, set EXECUTE_ORDER=1 and re-run the script.');
    return;
  }

  console.log('\nSTEP 4 — Executing live order (this will place a real order!)');
  try {
    const res = await client.safePlaceOrder({ ...recommended, apiKey, apiSecret, dryRun: false, confirmCallback: async () => true, logFn: console.log });
    console.log('Live order response:', res);
  } catch (e) {
    console.error('Live order failed:', e);
  }
}

run();
