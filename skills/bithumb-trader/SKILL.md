---
name: bithumb-trader
description: Automate spot trading on Bithumb using their REST/Websocket APIs — use when the user requests trade execution planning, strategy implementation, backtesting scaffolding, or safe automation; do NOT execute real trades without explicit user confirmation and credentials.
---

# Bithumb Trader Skill

Purpose
- Provide a repeatable, auditable skill for building automated trading workflows against Bithumb (REST + WebSocket). This skill scaffolds API wrappers, strategy templates, backtesting hooks, safety checks, and deployment guidance.

When to use
- Use this skill when the user asks to build, test, or run trading strategies that interact with Bithumb.
- The skill should not perform trades autonomously without the user's explicit approval, credentials, and safety confirmation.

Included resources
- scripts/api/ - Bithumb API client (placeholders)
- scripts/backtest/ - Backtesting harness (placeholder)
- references/ - Bithumb API docs (link + extracted endpoints)
- examples/ - Example strategy templates (moving-average crossover, dollar-cost averaging)

Safety & Authorization (REQUIRED)
- Never store API keys in plain text within the skill. Use environment variables or the OpenClaw auth profiles with restricted scopes.
- Require an explicit user confirmation step before any live trade. Log every trade attempt with nonce, signature, and user approval record.
- Implement kill-switch and dry-run mode: dry-run simulates orders without sending them.
- Add rate-limit handling and retry/backoff for HTTP 429 and network errors.

Quickstart (developer)
1. Create a new skill directory: `skills/bithumb-trader/`
2. Populate `scripts/api/bithumb_client.js` with REST wrappers.
3. Implement strategy in `examples/ma_crossover.js`.
4. Run backtests in `scripts/backtest/run_backtest.js`.
5. When ready for live: configure `BITHUMB_API_KEY`, `BITHUMB_API_SECRET` via env or OpenClaw auth profile and run with `--dry-run` first.

Model selection (skill-level config)
- This skill respects the global model-priority policy but exposes a machine-readable config block that automated runners can read.

```json
{
  "model_policy": {
    "main": "github-copilot/gpt-5-mini",
    "codex": "openai/codex",
    "fallback": "gpt-4.1"
  }
}
```

Outputs
- Deterministic scripts for API calls and backtesting (JS/Python templates)
- SKILL.md with clear triggers and safety notes (this file)
- Packaging instructions (scripts/package_skill.py ready)

Maintenance
- Update references/api_docs.md if Bithumb changes endpoints
- Keep an eye on regulatory rules for automated trading in your jurisdiction

