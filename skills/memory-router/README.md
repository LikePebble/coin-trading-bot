Memory Router Skill

To run tests:
- node router_test_runner.js (not included) or integrate router.handle into OpenClaw skill hook.

What I implemented:
- router.js: scaffold for classify -> call -> summarize -> verify -> commit
- pii_rules.json: basic PII regex rules
- tests/pii_tests.txt: sample PII cases

Next steps I can do for you:
- Wire summarize/verify calls to sessions_spawn for actual mini/Codex calls
- Implement automated test runner to execute PII tests and report
- Configure memory-lancedb detailed options if you provide embedding auth method
