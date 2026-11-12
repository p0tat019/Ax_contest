import { validWorkEmail, workMailRoutes, workRoles } from '../public/work-mail-routes.mjs';
import { sendGmailWorkMail } from './gmail-work-mail.mjs';
import { workMailContent } from './work-mail-content.mjs';

const digest = (value) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
const deliveries = new Map();
const deliveryLifetime = 24 * 60 * 60 * 1000;

async function authorized(token, secret) {
  if (!token || token.length > 256 || !secret || secret.length < 24) return false;
  const [actual, expected] = await Promise.all([digest(token), digest(secret)]);
  const a = new Uint8Array(actual);
  const b = new Uint8Array(expected);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

async function readRequest(request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const buffer = new Uint8Array(1024);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(new TextDecoder().decode(buffer.subarray(0, offset)));
      if (value.byteLength + offset > buffer.length) {
        await reader.cancel();
        return null;
      }
      buffer.set(value, offset);
      offset += value.byteLength;
    }
  } catch {
    return null;
  }
}

export async function sendWorkMail(request, env, origin, headers) {
  const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });
  const fail = (status, error) => reply(status, { error });
  if (![env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN].every((value) => value?.trim())
    || !validWorkEmail(env.GMAIL_SENDER?.trim()) || !env.COREVIA_MAIL_RECIPIENTS
    || !env.COREVIA_MAIL_DISPATCH_TOKEN || !env.CLIENT_LIMIT || !env.SHARED_LIMIT) {
    return fail(503, 'Gmail 발신 설정과 허용된 담당자 주소를 서버에 등록하세요.');
  }
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return fail(403, '발송 인증을 확인하세요.');
  try {
    if (!(await env.CLIENT_LIMIT.limit({ key: `mail/${ip}` })).success) return fail(429, '요청이 많습니다. 잠시 뒤 다시 시도하세요.');
    if (!await authorized(request.headers.get('X-Corevia-Mail-Key'), env.COREVIA_MAIL_DISPATCH_TOKEN)) {
      return fail(403, '발송 인증을 확인하세요.');
    }
    const input = await readRequest(request);
    const { task, role, type, to } = input ?? {};
    if (typeof role !== 'string' || typeof type !== 'string') return fail(400, '업무 유형을 확인하세요.');
    const route = `${type}/${role}`;
    if (!input || Object.keys(input).length !== 4 || typeof task !== 'string' || !/^[a-f0-9]{64}$/.test(task)
      || !Object.hasOwn(workMailRoutes, route) || !validWorkEmail(to)) return fail(400, '담당자 주소와 작업 유형을 확인하세요.');
    let recipients;
    try { recipients = JSON.parse(env.COREVIA_MAIL_RECIPIENTS); }
    catch { return fail(503, '서버의 역할별 담당자 이메일 설정 형식을 확인하세요.'); }
    const email = to.toLowerCase();
    if (!Array.isArray(recipients?.[role]) || !recipients[role].some((address) => address === email)) {
      return fail(403, '이 역할에 발송이 허용된 주소를 등록하세요.');
    }
    if (!(await env.SHARED_LIMIT.limit({ key: 'work-mail' })).success) return fail(429, '메일 발송 요청이 많습니다. 잠시 뒤 다시 시도하세요.');
    const title = workMailRoutes[route];
    const link = new URL(`/#work-mail-${task}`, origin);
    const now = Date.now();
    for (const [key, delivery] of deliveries) {
      if (delivery.expires <= now) deliveries.delete(key);
    }
    const key = `${origin}/${env.GMAIL_SENDER.trim().toLowerCase()}/${task}`;
    const delivery = deliveries.get(key);
    if (delivery && (delivery.route !== route || delivery.email !== email)) {
      return fail(409, '이 작업은 다른 발송 정보로 이미 요청됐습니다.');
    }
    if (delivery?.status === 'accepted') return reply(200, { accepted: true });
    if (delivery?.status === 'unknown') return fail(409, '메일 발송 결과가 불확실합니다. Gmail 보낸편지함을 먼저 확인하세요.');
    if (delivery?.status === 'sending') return fail(409, '같은 작업의 발송을 처리 중입니다.');
    if (deliveries.size >= 4096) return fail(429, '메일 요청이 많습니다. 잠시 뒤 다시 시도하세요.');
    const entry = { route, email, expires: now + deliveryLifetime, status: 'sending' };
    deliveries.set(key, entry);
    try {
      entry.status = await sendGmailWorkMail(env, {
        to: email, task, ...workMailContent(route, title, workRoles[role], link),
      });
    } catch (error) {
      deliveries.delete(key);
      return fail(502, error.message.startsWith('Gmail 발송 권한') ? error.message : 'Google 발송 인증에 연결하지 못했습니다.');
    }
    if (entry.status === 'accepted') return reply(200, { accepted: true });
    if (entry.status === 'unknown') return fail(409, '메일 발송 결과가 불확실합니다. Gmail 보낸편지함을 먼저 확인하세요.');
    deliveries.delete(key);
    return fail(502, 'Gmail에서 발송 요청을 거절했습니다. 발신 계정과 권한을 확인하세요.');
  } catch {
    return fail(502, '메일 발송 결과를 확인하지 못했습니다.');
  }
}
