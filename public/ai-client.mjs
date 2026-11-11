import { aiOrigin, turnstileSiteKey } from './ai-config.mjs';
import { findQuantityChange, selectAction } from './ai-logic.mjs';

let turnstileScript;
const local = () => ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  turnstileScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    const timer = setTimeout(() => fail(), 12000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      turnstileScript = undefined;
      reject(new Error('브라우저 확인을 불러오지 못했습니다. 다시 시도하세요.'));
    }
    script.onload = () => {
      if (!window.turnstile) return fail();
      clearTimeout(timer);
      resolve(window.turnstile);
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return turnstileScript;
}

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(35000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'AI 서비스에 연결하지 못했습니다.');
  return data;
}

async function publicAnswer(feature, codes, anchor) {
  if (!aiOrigin || !turnstileSiteKey) throw new Error('게시용 AI 연결을 설정하고 있습니다.');
  const turnstile = await loadTurnstile();
  const container = document.createElement('div');
  anchor.after(container);
  let widget;
  let timer;
  try {
    const token = await new Promise((resolve, reject) => {
      const fail = () => reject(new Error('브라우저 확인을 완료하지 못했습니다. 다시 시도하세요.'));
      timer = setTimeout(fail, 90000);
      widget = turnstile.render(container, {
        sitekey: turnstileSiteKey,
        action: `corevia_${feature}`,
        appearance: 'interaction-only',
        language: 'ko',
        retry: 'never',
        callback: resolve,
        'error-callback': fail,
        'expired-callback': fail,
        'timeout-callback': fail,
      });
    });
    return (await post(`${aiOrigin}/api/${feature}`, { codes }, { 'X-Corevia-Token': token })).answer;
  } finally {
    clearTimeout(timer);
    if (widget !== undefined) turnstile.remove(widget);
    container.remove();
  }
}

export async function requestAssistant(message, context, anchor) {
  if (local()) return post('/api/assistant', { message, context });
  const { codes, action } = selectAction(message, context);
  const answer = await publicAnswer('assistant', codes, anchor);
  return { ...action, answer, ...(action.skill === 'draft_data_request' ? { detail: answer } : {}) };
}

export async function requestFeedback(feedback, row, anchor) {
  if (local()) return post('/api/feedback', { feedback, row });
  const candidate = findQuantityChange(feedback, row);
  const reason = await publicAnswer('feedback', [candidate ? 'draft_change' : 'clarify_change', 'capacity'], anchor);
  return { ...(candidate ?? { field: 'none' }), reason };
}
