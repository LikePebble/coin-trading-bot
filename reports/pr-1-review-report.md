# PR #1 Review Report — coin-trading-bot

Date: 2026-02-18 (Asia/Seoul)
Reviewer model: openai-codex/gpt-5.3-codex
PR: https://github.com/LikePebble/coin-trading-bot/pull/1

## Scope & Method
- Fetched PR head into local branch (`pr-1`).
- Ran syntax/tests/security checks:
  - `node --check scripts/*.js`
  - `npm test` (repo currently has placeholder test script)
  - `npm audit --omit=dev`
- Ran dry-run execution smoke test (no live order execution):
  - `LIVE_MODE=false node -e "...runOnce(...)..."`
- Performed focused manual code review for:
  - API key handling
  - signing/live-order safety
  - trading guardrails and operational safety

## Baseline Findings (before patch)
1. **Live-trade safety switch was single-factor**
   - `LIVE_MODE=true` was enough to leave dry-run path (though code still throws before real execution).
   - Recommendation: dual-confirmation toggle for live mode.

2. **Insufficient order input validation**
   - `price` / `quantity` / `amountKRW` could become invalid (e.g., ticker parse = 0) and propagate toward `placeOrder`.

3. **`RUN_END_TIME` config existed but was not enforced**
   - Long loop could run beyond intended hard stop.

4. **Public ticker test unnecessarily required API keys**
   - `bithumb_api_test.js` exited if keys were missing, despite using a public endpoint.

5. **Dependency security note**
   - `npm audit --omit=dev` reports 1 high issue in `playwright <1.55.1` (upstream advisory).

## Patch Applied (branch: `pr-1-reviewed`)
### 1) Hardened live-trade gate in `scripts/bithumb_client.js`
- Added explicit secondary switch:
  - `LIVE_TRADING_ENABLED === 'true'` required in addition to `LIVE_MODE=true`.
- Added strict validation:
  - `price > 0`, `quantity > 0`, side in `{buy,sell}`.
- Kept hard-stop behavior for live execution (still refuses to send real orders/sign requests).

### 2) Added guardrails in `scripts/live_runner.js`
- Validate `amountKRW` is finite/positive.
- Validate ticker price before computing quantity.
- Validate computed quantity is finite/positive.
- Enforce `LIMITS.END_TIME` as a hard cap for loop runtime.

### 3) Fixed unnecessary key requirement in `scripts/bithumb_api_test.js`
- Removed API key/secret precheck for public ticker-only script.

## Dry-run Verification
Command:
- `LIVE_MODE=false node -e "const {runOnce}=require('./scripts/live_runner'); ..."`

Result:
- `DRY_RUN_OK true BTC_KRW 10000`
- Confirms simulated order path only (no live trade path used).

## Lint/Test/Static Results
- `node --check scripts/*.js`: **PASS**
- `npm test`: **FAIL** (expected; placeholder script: `Error: no test specified`)
- `npm audit --omit=dev`: **1 high vulnerability** (`playwright` advisory)

## Additional Recommendations (not auto-applied)
1. Add automated tests for safety invariants:
   - live mode blocked without dual toggle
   - invalid ticker/order values rejected
   - hard end-time respected
2. Introduce structured risk controls for production:
   - min/max slippage checks
   - max position by symbol
   - cooldown interval after failures
   - circuit breaker on repeated API anomalies
3. If live trading is ever implemented:
   - isolated signing module with nonce replay protection
   - deterministic signature tests against exchange docs
   - explicit runtime kill-switch and allowlisted endpoints only
4. Upgrade `playwright` to patched version (`>=1.55.1`) when compatible.

## Artifacts
- Review report: `reports/pr-1-review-report.md`
- Check logs: `reports/pr-1-review-checks.txt`
- Patched files:
  - `scripts/bithumb_client.js`
  - `scripts/live_runner.js`
  - `scripts/bithumb_api_test.js`
