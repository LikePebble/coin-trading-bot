require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { executeSignedOrder, getOrderByUuid } = require('../../scripts/bithumb_client');

(async () => {
  const artifactDir = process.argv[2];
  const outPath = path.join(artifactDir, 'result.json');
  const logPath = path.join(artifactDir, 'run.log');
  const startedAt = new Date().toISOString();

  const amountKRW = 5000;
  const limitPrice = 99912000;
  const volume = (amountKRW / limitPrice).toFixed(8);

  const result = {
    startedAt,
    params: {
      market: 'BTC_KRW',
      side: 'bid',
      ord_type: 'limit',
      amountKRW,
      limitPrice,
      volume,
    },
    attempts: [],
  };

  function appendLog(msg) {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
  }

  try {
    if (!process.env.BITHUMB_API_KEY || !process.env.BITHUMB_API_SECRET) {
      throw new Error('Missing BITHUMB_API_KEY or BITHUMB_API_SECRET in environment');
    }

    const maxAttempts = 3;
    let orderResp = null;

    for (let i = 1; i <= maxAttempts; i += 1) {
      const attempt = { attempt: i, ts: new Date().toISOString() };
      try {
        appendLog(`Submitting signed order attempt ${i}`);
        const resp = await executeSignedOrder({
          market: 'BTC_KRW',
          side: 'bid',
          ord_type: 'limit',
          price: String(limitPrice),
          volume,
          timeoutMs: 12000,
        });
        attempt.success = true;
        attempt.response = resp;
        result.attempts.push(attempt);
        orderResp = resp;
        break;
      } catch (err) {
        attempt.success = false;
        attempt.error = {
          message: err.message,
          code: err.code,
          status: err.response?.status,
          data: err.response?.data,
        };
        result.attempts.push(attempt);
        appendLog(`Attempt ${i} failed: ${err.message}`);
        if (i < maxAttempts) {
          const delay = 1000 * (2 ** (i - 1));
          appendLog(`Backing off for ${delay}ms`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (!orderResp) {
      result.status = 'submit_failed';
      result.finishedAt = new Date().toISOString();
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      appendLog('Order submission failed after retries');
      process.exit(1);
    }

    const orderId = orderResp.uuid || orderResp.order_id || orderResp.id || null;
    result.orderId = orderId;
    result.submitResponse = orderResp;

    if (!orderId) {
      result.status = 'submitted_no_order_id';
      result.finishedAt = new Date().toISOString();
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      appendLog('Order submitted but no order identifier found in response');
      process.exit(0);
    }

    appendLog(`Order submitted with orderId=${orderId}. Monitoring up to 60s.`);
    const monitorStart = Date.now();
    result.monitor = [];

    while (Date.now() - monitorStart <= 60000) {
      try {
        const statusResp = await getOrderByUuid({ uuid: orderId, timeoutMs: 12000 });
        result.monitor.push({ ts: new Date().toISOString(), response: statusResp });
        const state = statusResp.state || statusResp.status || '';
        const remaining = Number(statusResp.remaining_volume ?? statusResp.remaining ?? '1');
        if (String(state).toLowerCase() === 'done' || remaining === 0) {
          result.status = 'filled';
          break;
        }
      } catch (err) {
        result.monitor.push({
          ts: new Date().toISOString(),
          error: {
            message: err.message,
            code: err.code,
            status: err.response?.status,
            data: err.response?.data,
          },
        });
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    if (!result.status) {
      result.status = 'submitted_unfilled_within_60s';
    }

    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    appendLog(`Completed with status=${result.status}`);
  } catch (err) {
    result.status = 'fatal_error';
    result.error = {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      data: err.response?.data,
    };
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] Fatal error: ${err.message}\n`);
    process.exit(1);
  }
})();
