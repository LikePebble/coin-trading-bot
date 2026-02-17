// Memory-router skill scaffold for OpenClaw
// summarize -> verify -> commit with PII blocking

const fs = require('fs');
const path = require('path');

const DEFAULT_MEMORY_DIR = path.resolve(process.env.HOME || '~', '.openclaw', 'memory');
const PII_RULES = require('./pii_rules.json');
const CONFIG = (() => {
  try { return require('./config.json'); } catch (e) { return {}; }
})();

function maskLogs(text) {
  if (!CONFIG.enableLogMasking) return text;
  let out = text;
  for (const p of (CONFIG.maskPatterns||[])) {
    try {
      const re = new RegExp(p, 'g');
      out = out.replace(re, '[REDACTED]');
    } catch (e) { /* ignore bad pattern */ }
  }
  return out;
}


function detectPII(text) {
  const hits = [];
  for (const r of PII_RULES) {
    const re = new RegExp(r.pattern, r.flags || 'g');
    const match = text.match(re);
    if (match) hits.push({ type: r.name, sample: match.slice(0, 2) });
  }
  return hits;
}

function resolveSessionsSpawn(opts = {}) {
  const fn = opts.sessions_spawn || global.sessions_spawn;
  if (typeof fn !== 'function') {
    throw new Error('sessions_spawn is not configured; pass opts.sessions_spawn or provide global.sessions_spawn');
  }
  return fn;
}

async function callModel({ model, prompt, system, opts }) {
  const sessionsSpawn = resolveSessionsSpawn(opts);
  return sessionsSpawn({
    model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ],
    temperature: 0.1,
  });
}

function extractText(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (typeof resp.output_text === 'string') return resp.output_text;
  if (typeof resp.text === 'string') return resp.text;
  if (Array.isArray(resp.output)) {
    return resp.output
      .flatMap((o) => o?.content || [])
      .map((c) => c?.text || '')
      .join('\n')
      .trim();
  }
  return JSON.stringify(resp);
}

async function summarizeWithMini(originalText, opts = {}) {
  const prompt = [
    'Summarize the assistant response below for long-term memory.',
    'Rules: 2-4 concise bullets, factual only, no secrets, no PII, no speculation.',
    '',
    'Assistant response:',
    originalText,
  ].join('\n');

  const resp = await callModel({
    model: 'github-copilot/gpt-5-mini',
    prompt,
    system: 'You create short, faithful memory summaries.',
    opts,
  });

  return extractText(resp).trim();
}

async function verifyWithMini(summary, original, opts = {}) {
  const prompt = [
    'Evaluate whether the summary is faithful to the original response.',
    'Return strict JSON only: {"confidence": number, "reason": string}.',
    'confidence must be 0..1.',
    '',
    'Original:',
    original,
    '',
    'Summary:',
    summary,
  ].join('\n');

  const resp = await callModel({
    model: 'github-copilot/gpt-5-mini',
    prompt,
    system: 'You are a strict verifier. Output JSON only.',
    opts,
  });

  const raw = extractText(resp).trim();
  let confidence = 0;
  let reason = 'unparseable verify response';

  try {
    const parsed = JSON.parse(raw);
    const n = Number(parsed.confidence);
    if (!Number.isNaN(n)) confidence = Math.max(0, Math.min(1, n));
    reason = parsed.reason || reason;
  } catch {
    const m = raw.match(/(0(?:\.\d+)?|1(?:\.0+)?)/);
    if (m) confidence = Number(m[1]);
    reason = raw.slice(0, 280) || reason;
  }

  return { confidence, reason, raw };
}

function commitSummary(metadata, summary, opts = {}) {
  const memoryDir = opts.memoryDir || process.env.OPENCLAW_MEMORY_DIR || DEFAULT_MEMORY_DIR;
  if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
  const fname = path.join(memoryDir, `${Date.now()}_${metadata.intent || 'misc'}.json`);
  const obj = { metadata, summary, ts: new Date().toISOString() };
  fs.writeFileSync(fname, JSON.stringify(obj, null, 2));
  return fname;
}

module.exports.detectPII = detectPII;
module.exports.summarizeWithMini = summarizeWithMini;
module.exports.verifyWithMini = verifyWithMini;
module.exports.commitSummary = commitSummary;

module.exports.handle = async function handleMessage(message, opts = {}) {
  const isCode = /```|\.py|function\(|console\.log/.test(message.text);
  const intent = isCode ? 'code' : 'general';

  const memoryHit = false;
  if (memoryHit) {
    return { model: 'github-copilot/gpt-5-mini', text: '(from memory) ...' };
  }

  // Respect exclusion config: do not store or process messages from excluded channels/users
  if (CONFIG.excludeChannels && message.channel && CONFIG.excludeChannels.includes(message.channel)) {
    return { model: 'github-copilot/gpt-5-mini', text: '(not stored: excluded channel)' };
  }
  if (CONFIG.excludeUsers && message.user && CONFIG.excludeUsers.includes(message.user)) {
    return { model: 'github-copilot/gpt-5-mini', text: '(not stored: excluded user)' };
  }

  let response;
  if (intent === 'code') {
    response = { model: 'openai-codex/gpt-5.3-codex', text: '// codex response placeholder' };
  } else {
    response = { model: 'github-copilot/gpt-5-mini', text: 'mini reply placeholder' };
  }

  if (response.model !== 'github-copilot/gpt-5-mini') {
    const summary = await summarizeWithMini(response.text, opts);
    const verify = await verifyWithMini(summary, response.text, opts);
    const threshold = opts.verifyThreshold || 0.75;

    if (verify.confidence >= threshold) {
      const pii = detectPII(response.text);
      if (pii.length > 0) {
        return {
          model: response.model,
          text: maskLogs(response.text),
          note: `PII blocked: ${pii.map((p) => p.type).join(',')}`,
          verify,
          summary,
          pii,
          blocked: true,
        };
      }
      const committed = commitSummary({ sourceModel: response.model, intent }, summary, opts);
      return { model: response.model, text: maskLogs(response.text), committed, verify, summary, blocked: false };
    }

    return {
      model: response.model,
      text: response.text,
      note: 'verification failed — not committed',
      verify,
      summary,
      blocked: true,
    };
  }

  return response;
};