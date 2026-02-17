#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const router = require('../router');

const TEST_FILE = path.join(__dirname, 'pii_tests.txt');
const THRESHOLD = 0.75;

function parseCases(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const parts = line.split(':');
      const label = parts[0]?.trim() || `case_${idx + 1}`;
      const text = parts.slice(1).join(':').trim() || line;
      return { id: idx + 1, label, text, raw: line };
    });
}

function makeMockSessionsSpawn() {
  return async ({ messages }) => {
    const prompt = (messages || []).map((m) => m.content || '').join('\n');
    if (prompt.includes('Return strict JSON only')) {
      return { text: JSON.stringify({ confidence: 0.93, reason: 'Summary is faithful enough.' }) };
    }
    const excerpt = prompt.slice(0, 120).replace(/\s+/g, ' ').trim();
    return { text: `- 핵심 요약: ${excerpt}` };
  };
}

async function main() {
  const raw = fs.readFileSync(TEST_FILE, 'utf8');
  const cases = parseCases(raw);

  const sessionsSpawn = global.sessions_spawn || makeMockSessionsSpawn();
  const usingReal = Boolean(global.sessions_spawn);

  const tmpMemoryDir = path.join(__dirname, '.tmp-memory');
  fs.mkdirSync(tmpMemoryDir, { recursive: true });

  const results = [];
  for (const c of cases) {
    const pii = router.detectPII(c.text);
    const summary = await router.summarizeWithMini(c.text, { sessions_spawn: sessionsSpawn });
    const verify = await router.verifyWithMini(summary, c.text, { sessions_spawn: sessionsSpawn });
    const blocked = pii.length > 0 || verify.confidence < THRESHOLD;

    let committed = null;
    if (!blocked) {
      committed = router.commitSummary({ sourceModel: 'openai-codex/gpt-5.3-codex', intent: 'test' }, summary, {
        memoryDir: tmpMemoryDir,
      });
    }

    results.push({
      id: c.id,
      label: c.label,
      text: c.text,
      piiTypes: pii.map((p) => p.type),
      verifyConfidence: verify.confidence,
      blocked,
      committed,
    });
  }

  const blockedCount = results.filter((r) => r.blocked).length;
  const commitCount = results.length - blockedCount;

  const report = {
    generatedAt: new Date().toISOString(),
    threshold: THRESHOLD,
    usingRealSessionsSpawn: usingReal,
    casesTotal: results.length,
    blockedCount,
    commitCount,
    results,
    requiredConfigChanges: usingReal
      ? []
      : ['Provide runtime sessions_spawn binding (global.sessions_spawn or opts.sessions_spawn) to enable real model calls.'],
  };

  const outPath = path.join(__dirname, 'pii_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});