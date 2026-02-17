# Memory-router summarize→verify→commit report

## 1) Integration implemented
- Updated `skills/memory-router/router.js` to replace summarize/verify placeholders with real `sessions_spawn` wiring:
  - `summarizeWithMini(...)` calls model `github-copilot/gpt-5-mini`
  - `verifyWithMini(...)` calls model `github-copilot/gpt-5-mini` and parses confidence from strict JSON
- Added `callModel(...)` + `resolveSessionsSpawn(...)` so runtime can inject `opts.sessions_spawn` (or use `global.sessions_spawn`)
- Kept commit gate logic: **verify confidence >= threshold** and **no PII hit**

## 2) PII suite execution
Runner added: `skills/memory-router/tests/run_pii_suite.js`

Executed with:
`node skills/memory-router/tests/run_pii_suite.js`

### Results
- Total cases: 5
- Blocked from commit: 4
- Committed: 1

Blocked cases:
1. 전화번호 (`010-1234-5678`) → Phone
2. 주민등록번호 (`900101-1234567`) → Korean Resident ID
3. 신용카드 (`4111111111111111`) → Credit Card
4. 이메일+비밀번호 (`email: test@example.com password: hunter2`) → Email+Password Combo

Allowed:
- 일반문장 (`오늘 날씨 어때?`) → committed

## 3) Failures / required config changes
- **Current run used mock `sessions_spawn`** because no runtime binding was present in this standalone Node test run.
- Required config change for real model validation:
  - Provide `sessions_spawn` in skill runtime (`opts.sessions_spawn` or `global.sessions_spawn`) so summarize/verify use live `github-copilot/gpt-5-mini` calls.

Artifacts:
- JSON report: `skills/memory-router/tests/pii_report.json`
- Markdown report: `skills/memory-router/tests/pii_report.md`
