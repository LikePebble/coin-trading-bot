Rollout & Runbook (Bithumb intraday bot)

Preflight checks
- Ensure API keys with correct scopes are provisioned and IP whitelist is correct.
- Run `node scripts/api/bithumb_jwt_suite.js` and confirm JWT endpoints succeed.
- Run backtest: `npm run backtest` (or `node scripts/backtest/run_backtest.js`) and review metrics.
- Run paper trading for 7 days: `DRY_RUN=1 node scripts/bot/trading_loop.js` (wire fetchCandles implementation).
- Test kill-switch: create runtime/KILL_SWITCH file and ensure loop halts.

Live activation
- Generate a one-time LIVE_APPROVAL_TOKEN and share via secure channel.
- Start with small scaling factor: reduce RISK_PER_TRADE_PCT by 80% for first 24h.
- Enable: `EXECUTE_ORDER=1 LIVE_APPROVAL_TOKEN=xxxx node scripts/bot/trading_loop.js`
- Monitor logs: runtime/audit.log and alerts.

If anomaly
- Immediately set KILL_SWITCH file or unset EXECUTE_ORDER.
- Cancel open orders via exchange UI or API.
- Archive logs and note incident.

Notes
- Always rotate keys if you suspect exposure.
- Maintain conservative risk limits and increase gradually.
