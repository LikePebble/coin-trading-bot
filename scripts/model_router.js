/**
 * model_router.js
 *
 * Node.js wrapper to route requests to models according to workspace policy.
 * - Main model: github-copilot/gpt-5-mini
 * - Complex tasks -> openai codex (OAuth) if requested or heuristics say complex
 * - Codex failure -> fallback to gpt-4.1
 *
 * Features:
 * - Heuristic complexity scoring (length, code blocks, keywords, explicit flag)
 * - Optional probe (lightweight classifier) using the main model
 * - Automatic retry/fallback on failure or timeout
 * - Logs decisions for auditing
 *
 * Usage:
 * const router = require('./model_router');
 * await router.init(); // optional
 * const res = await router.route({ prompt, useCodex:false, timeoutMs:10000 });
 * console.log(res);
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'model_router.log');
function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }
ensureDir(path.dirname(LOG_FILE));

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(a => (typeof a==='object'?JSON.stringify(a):a)).join(' ')}\n`;
  fs.appendFileSync(LOG_FILE, line);
}

const POLICY = {
  main: process.env.MODEL_MAIN || 'github-copilot/gpt-5-mini',
  codex: process.env.MODEL_CODEX || 'openai/codex',
  fallback: process.env.MODEL_FALLBACK || 'gpt-4.1',
  probeThreshold: 0.6 // probability threshold when using probe
};

const HIGH_PRIORITY_KEYWORDS = [
  'refactor','optimize','prove','formal proof','static analysis','concurrency','deadlock',
  'symbolic','type inference','compiler','performance profile','time complexity','big-O',
  'production','mission-critical','trading','financial','latency','throughput'
];

function countTokensEstimate(s) {
  // very rough estimate: 1 token ~= 4 chars
  return Math.ceil((s||'').length / 4);
}

function containsCodeBlocks(s){
  return /```[\s\S]*?```/.test(s) || /\b(function|const |let |var |import |include |class )/.test(s);
}

function keywordScore(s){
  const lower = (s||'').toLowerCase();
  let score = 0;
  for(const k of HIGH_PRIORITY_KEYWORDS){ if (lower.includes(k)) score += 3; }
  return score;
}

function heuristicScore(prompt){
  let score = 0;
  const tokens = countTokensEstimate(prompt);
  if (tokens > 800) score += 3;
  if (tokens > 1600) score += 4; // very long
  if (containsCodeBlocks(prompt)) score += 6;
  score += keywordScore(prompt);
  return {score, tokens};
}

async function probeClassifier(prompt, callMainModelFn){
  // call the main model with a short prompt asking yes/no whether codex-level needed
  // callMainModelFn should be a function that sends a short prompt and returns text
  const probePrompt = `Does the following task require a specialized coding model (yes/no)?\n\nTask:\n${prompt}\n\nAnswer with exactly 'yes' or 'no'.`;
  try{
    const resp = await callMainModelFn(probePrompt, {maxTokens:16, temperature:0});
    const txt = (resp||'').toLowerCase();
    if (txt.includes('yes')) return {needs:true, prob:0.9};
    if (txt.includes('no')) return {needs:false, prob:0.1};
    return {needs:false, prob:0.5};
  }catch(err){
    log('probe error', err.message);
    return {needs:false, prob:0.5};
  }
}

// Placeholder model-call functions. Replace with your actual SDK calls.
async function callModel(modelId, prompt, opts={}){
  // opts: {timeoutMs, maxTokens}
  // This function should be implemented to call the actual provider (OpenAI, GitHub Copilot, Codex).
  // For now, we throw if not configured.
  log('callModel', modelId, `tokens~${countTokensEstimate(prompt)}`);
  if (modelId.startsWith('github-copilot') || modelId.includes('gpt-5') ){
    // Example: call github-copilot endpoint if available via env token
    const token = process.env.COPILOT_TOKEN;
    if (!token) throw new Error('COPILOT_TOKEN not set');
    // This is a stub. Integrate real SDK here.
    return `[stub response from ${modelId}]`; 
  }
  if (modelId === 'openai/codex' || modelId.toLowerCase().includes('codex')){
    const token = process.env.OPENAI_TOKEN; // OAuth token expected
    if (!token) throw new Error('OPENAI_TOKEN not set');
    // Stub
    return `[stub response from codex]`;
  }
  if (modelId === 'gpt-4.1' || modelId.toLowerCase().includes('gpt-4')){
    const token = process.env.OPENAI_TOKEN || process.env.FALLBACK_TOKEN;
    if (!token) throw new Error('OPENAI_TOKEN not set for fallback');
    return `[stub response from ${modelId}]`;
  }
  throw new Error('Unknown model: '+modelId);
}

async function route({prompt, useCodex=false, probe=false, timeoutMs=15000, maxTokens=1024, temperature=0.2}){
  const heur = heuristicScore(prompt);
  let decision = {model: POLICY.main, reason: 'default'};

  if (useCodex){ decision = {model: POLICY.codex, reason: 'user_flag'}; }
  else{
    // heuristic threshold: score >=6 -> codex
    if (heur.score >= 6) { decision = {model: POLICY.codex, reason: 'heuristic'}; }
    else if (probe){
      // run probe using main model
      const probeRes = await probeClassifier(prompt, async (p, opts)=> await callModel(POLICY.main, p, opts));
      if (probeRes.needs && probeRes.prob >= POLICY.probeThreshold) decision = {model: POLICY.codex, reason: 'probe'};
    }
  }

  log('route decision', decision, heur);

  // Try model call with retry/fallback
  try{
    const resp = await callModel(decision.model, prompt, {timeoutMs, maxTokens, temperature});
    log('model response', decision.model);
    return {model: decision.model, response: resp, decision, heur};
  }catch(err){
    log('model error', decision.model, err.message);
    // If codex failed, fallback to gpt-4.1
    if (decision.model === POLICY.codex){
      try{
        log('fallback to', POLICY.fallback);
        const resp2 = await callModel(POLICY.fallback, prompt, {timeoutMs, maxTokens, temperature});
        return {model: POLICY.fallback, response: resp2, decision: {...decision, fallback:true}, heur};
      }catch(err2){
        log('fallback error', err2.message);
        throw err2;
      }
    }
    // Otherwise bubble up
    throw err;
  }
}

module.exports = { route, heuristicScore, containsCodeBlocks, callModel };
