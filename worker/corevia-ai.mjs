import { explainCodes } from '../scripts/gemini-safe.mjs';
import { assistantPrompt, feedbackPrompt } from '../scripts/gemini-prompts.mjs';

const modules = new Set(['dashboard', 'intake', 'capacity', 'review', 'proposal']);
const statuses = new Set(['not_started', 'intake_reviewed', 'calculation_ready', 'existing_shortage',
  'department_review', 'approval_waiting', 'submitted', 'recalculate']);
const topics = new Set(['first_delivery', 'split_delivery', 'deadline', 'existing_orders', 'weekly_capacity', 'payment', 'penalty']);
const changes = new Set(['draft_change', 'clarify_change']);
const routes = {
  '/api/assistant': { action: 'corevia_assistant', prompt: assistantPrompt },
  '/api/feedback': { action: 'corevia_feedback', prompt: feedbackPrompt },
};

function validCodes(path, codes) {
  if (!Array.isArray(codes)) return false;
  const [intent, context, status] = codes;
  if (changes.has(intent)) return codes.length === 2 && context === 'capacity';
  if (path === '/api/feedback') return false;
  if (intent === 'explain') return codes.length === 3 && modules.has(context) && statuses.has(status);
  if (intent === 'navigate') return codes.length === 2 && modules.has(context);
  return intent === 'request_data' && codes.length === 2 && topics.has(context);
}

async function readCodes(request, path) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let length = 0;
  let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 512) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    const input = JSON.parse(body + decoder.decode());
    return input && Object.keys(input).length === 1 && validCodes(path, input.codes) ? input.codes : null;
  } catch {
    return null;
  }
}

async function validateTurnstile(secret, token, hostname, action, ip) {
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true && result.hostname === hostname && result.action === action;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.FRONTEND_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const allowedOrigin = origin?.startsWith('https://') && allowed.includes(origin);
    const headers = new Headers({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Origin',
    });
    if (allowedOrigin) headers.set('Access-Control-Allow-Origin', origin);
    const send = (status, error) => new Response(JSON.stringify({ error }), { status, headers });
    const path = new URL(request.url).pathname;
    if (!Object.hasOwn(routes, path)) return send(404, '요청 경로를 확인하세요.');
    if (!allowedOrigin) return send(403, '허용된 앱에서 요청하세요.');
    const route = routes[path];
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Access-Control-Request-Method') !== 'POST') return send(405, 'POST 요청만 사용할 수 있습니다.');
      headers.set('Access-Control-Allow-Methods', 'POST');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Corevia-Token');
      headers.set('Access-Control-Max-Age', '600');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'POST') return send(405, 'POST 요청만 사용할 수 있습니다.');
    if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return send(415, 'JSON 요청만 사용할 수 있습니다.');
    }
    const token = request.headers.get('X-Corevia-Token');
    const ip = request.headers.get('CF-Connecting-IP');
    if (!token || token.length > 2048 || !ip) return send(403, '브라우저 확인이 필요합니다.');
    if (!env.GEMINI_API_KEY || !env.TURNSTILE_SECRET || !env.CLIENT_LIMIT || !env.SHARED_LIMIT) {
      return send(503, 'AI 서비스 설정을 확인하고 있습니다.');
    }
    const codes = await readCodes(request, path);
    if (!codes) return send(400, '지원하는 업무 코드만 보낼 수 있습니다.');
    try {
      const client = await env.CLIENT_LIMIT.limit({ key: ip });
      if (!client.success) return send(429, '요청이 많습니다. 잠시 뒤 다시 시도하세요.');
      const verified = await validateTurnstile(env.TURNSTILE_SECRET, token, new URL(origin).hostname, route.action, ip);
      if (!verified) return send(403, '브라우저 확인에 실패했습니다. 다시 시도하세요.');
      const shared = await env.SHARED_LIMIT.limit({ key: 'gemini' });
      if (!shared.success) return send(429, 'AI 서비스 요청이 많습니다. 잠시 뒤 다시 시도하세요.');
      const answer = await explainCodes(route.prompt, codes, env);
      return new Response(JSON.stringify({ answer }), { status: 200, headers });
    } catch {
      return send(502, 'AI 서비스 응답을 확인하지 못했습니다.');
    }
  },
};
