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
const mailCalls = [];
let oauthCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (url === 'https://oauth2.googleapis.com/token') {
    oauthCalls++;
    assert.deepEqual(Object.fromEntries(options.body), { client_id: 'client', client_secret: 'secret',
      refresh_token: 'refresh', grant_type: 'refresh_token' });
    return Response.json({ access_token: 'mock-access' });
  }
  if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
    assert.equal(options.headers.Authorization, 'Bearer mock-access');
    const mime = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString('utf8');
    mailCalls.push(mime);
    return Response.json({ id: 'simulated-delivery' });
  }
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

  const dispatchKey = 'unit-test-token-at-least-24-characters';
  const mailEnv = { ...env, GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'refresh', GMAIL_SENDER: 'workflow@example.com',
    COREVIA_MAIL_DISPATCH_TOKEN: dispatchKey, COREVIA_MAIL_RECIPIENTS: '{"approver":["reviewer@example.com"]}' };
  const task = 'a'.repeat(64);
  const payload = { task, role: 'approver', type: 'approval', to: 'reviewer@example.com' };
  const mailRequest = (input = payload, extra = {}) => new Request('https://worker.example/api/work-mail', {
    method: 'POST', body: JSON.stringify(input), headers: { Origin: origin, 'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.12', 'X-Corevia-Mail-Key': dispatchKey, ...extra },
  });
  assert.equal((await worker.fetch(mailRequest(), env)).status, 503);
  assert.equal((await worker.fetch(mailRequest(payload, { Origin: 'https://other.example' }), mailEnv)).status, 403);
  assert.equal((await worker.fetch(mailRequest(payload, { 'X-Corevia-Mail-Key': '' }), mailEnv)).status, 403);
  assert.equal((await worker.fetch(mailRequest({ ...payload, to: 'unknown@example.com' }), mailEnv)).status, 403);
  assert.equal((await worker.fetch(mailRequest({ ...payload, role: 'sales' }), mailEnv)).status, 400);
  assert.equal((await worker.fetch(mailRequest({ ...payload, body: 'confidential input' }), mailEnv)).status, 400);
  assert.equal(mailCalls.length, 0);
  for (let attempt = 0; attempt < 2; attempt++) {
    const accepted = await worker.fetch(mailRequest(), mailEnv);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { accepted: true });
  }
  assert.equal(oauthCalls, 1);
  assert.equal(mailCalls.length, 1);
  const boundary = `corevia_${task.slice(0, 24)}`;
  const [headers, plain, html] = mailCalls[0].split(`--${boundary}`);
  assert.match(headers, /From: Corevia <workflow@example\.com>\r\nTo: reviewer@example\.com/);
  assert.ok(headers.includes(`Message-ID: <corevia-${task}@example.com>`));
  const decodePart = (part) => Buffer.from(part.split('\r\n\r\n')[1], 'base64').toString('utf8');
  assert.ok(decodePart(plain).includes(`${origin}/#work-mail-${task}`));
  assert.ok(decodePart(html).includes(`href="${origin}/#work-mail-${task}"`));
  assert.ok(decodePart(html).includes('참여 승인, 보완 요청, 참여 보류'));
  assert.ok(decodePart(html).includes('부서 검수 결과와 재무·계약 위험'));
  console.log('PASS Gmail OAuth, role allowlist, MIME recipient and duplicate requests within one server instance');
} finally {
  globalThis.fetch = realFetch;
}
