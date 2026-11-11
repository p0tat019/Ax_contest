import assert from 'node:assert/strict';
import worker from '../worker/corevia-ai.mjs';

const origin = 'https://corevia.example';
const env = {
  FRONTEND_ORIGINS: origin, GEMINI_API_KEY: 'test-key', TURNSTILE_SECRET: 'test-secret',
  CLIENT_LIMIT: { limit: async () => ({ success: true }) },
  SHARED_LIMIT: { limit: async () => ({ success: true }) },
};
let verification = { success: true, hostname: 'corevia.example', action: 'corevia_feedback' };
let geminiCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url.includes('siteverify')) {
    assert.equal(options.body.get('response'), 'test-token');
    return Response.json(verification);
  }
  assert.ok(url.startsWith('https://generativelanguage.googleapis.com/'));
  assert.deepEqual(JSON.parse(options.body).contents, [{ parts: [{ text: '["draft_change","capacity"]' }] }]);
  geminiCalls++;
  return Response.json({ candidates: [{ content: { parts: [{ text: '근거를 확인하세요.' }] } }] });
};

function request(overrides = {}, payload = { codes: ['draft_change', 'capacity'] }) {
  return new Request('https://worker.example/api/feedback', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Corevia-Token': 'test-token',
      'CF-Connecting-IP': '192.0.2.12', ...overrides },
    body: JSON.stringify(payload),
  });
}

try {
  const preflight = await worker.fetch(new Request('https://worker.example/api/feedback', {
    method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await worker.fetch(request({ Origin: 'https://other.example' }), env)).status, 403);
  assert.equal((await worker.fetch(request({ 'X-Corevia-Token': '' }), env)).status, 403);
  assert.equal((await worker.fetch(request({}, { codes: ['draft_change','capacity'], feedback: 'private' }), env)).status, 400);
  assert.equal((await worker.fetch(request({}, { codes: ['private','capacity'] }), env)).status, 400);
  assert.equal((await worker.fetch(request(), { ...env, CLIENT_LIMIT: { limit: async () => ({ success: false }) } })).status, 429);
  verification = { success: true, hostname: 'other.example', action: 'corevia_feedback' };
  assert.equal((await worker.fetch(request(), env)).status, 403);
  verification = { success: true, hostname: 'corevia.example', action: 'corevia_assistant' };
  assert.equal((await worker.fetch(request(), env)).status, 403);
  assert.equal(geminiCalls, 0);
  verification = { success: true, hostname: 'corevia.example', action: 'corevia_feedback' };
  const result = await worker.fetch(request(), env);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { answer: '근거를 확인하세요.' });
  assert.equal(geminiCalls, 1);
  console.log('PASS Worker CORS, Turnstile hostname/action, rate limiting and code-only Gemini payload');
} finally {
  globalThis.fetch = realFetch;
}
