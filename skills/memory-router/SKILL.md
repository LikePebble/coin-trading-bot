# Memory Router Skill

Purpose: Implement summarize -> verify -> commit pipeline and PII filtering for OpenClaw.

Files:
- router.js: main skill handler (Node.js style pseudo-implementation for integration)
- pii_rules.json: regex rules for detecting PII
- tests/pii_tests.txt: sample test cases
- README.md: how to enable and run tests

Behavior:
1. classify incoming message (simple heuristics)
2. run memory_search; if hit and confidence high, respond using mini + note "(from memory)"
3. otherwise forward to subagent if needed
4. on subagent response, call summarize (mini) -> verify (mini with verification prompt) -> if verify score >= threshold, commit summary to memory store (write to memory files tagged)
5. PII filter runs before commit; any detected PII blocks commit and returns a masking warning

Notes:
- This is an integration scaffold. Adjust runtime hooks and APIs to your OpenClaw environment.
- Embedding/indexing is optional; initial commit stores summaries as files under memory/ for later ingestion.
