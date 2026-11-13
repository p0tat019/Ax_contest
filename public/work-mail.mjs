import { aiOrigin } from './ai-config.mjs';
import { experienceMode, loadState, saveState } from './workflow-storage.mjs?v=hands-on-demo-1';
import { validWorkEmail, workMailRoutes, workRoles } from './work-mail-routes.mjs';

const byId = (id) => document.getElementById(id);
const form = byId('work-mail-settings');
const status = byId('work-mail-status');
const roles = byId('work-mail-roles');
const stop = byId('work-mail-stop');
let assignments = loadState('work-mail-assignments') ?? {};
let sent = new Set(loadState('work-mail-sent') ?? []);
let scope = loadState('work-mail-scope');
let dispatchKey = '';
let queue = [];
let running = false;
let generation = 0;
let settingsVersion = 0;
const attempted = new Set();
const errors = new Map();

const roleOf = (task) => Object.keys(workRoles).find((key) => workRoles[key] === task.owner);
const typeOf = (task) => task.id.split('/', 1)[0];
export const assignedPerson = (task) => assignments[roleOf(task)]?.name ?? '';

async function fingerprint(task, address) {
  const data = new TextEncoder().encode(JSON.stringify([scope, task.id, roleOf(task), address]));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function taskForMailLink(hash, tasks) {
  const match = /^#work-mail-([a-f0-9]{64})$/.exec(hash);
  if (!match || !scope) return null;
  for (const task of tasks) {
    const address = assignments[roleOf(task)]?.email;
    if (address && await fingerprint(task, address) === match[1]) return task;
  }
  return null;
}

async function dispatch(task, role, email, key, version, settings) {
  const id = await fingerprint(task, email);
  if (version !== generation || !queue.some((item) => item.id === task.id) || sent.has(id) || attempted.has(id)) return;
  attempted.add(id);
  try {
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
    const result = await fetch(`${local ? '' : aiOrigin}/api/work-mail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Corevia-Mail-Key': key },
      body: JSON.stringify({ task: id, role, type: typeOf(task), to: email }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    const body = await result.json().catch(() => null);
    if (!result.ok || body?.accepted !== true) throw new Error(body?.error || '발송 서비스 응답을 확인하세요.');
    sent.add(id);
    if (!saveState('work-mail-sent', [...sent])) throw new Error('요청은 접수됐으나 발송 이력을 저장하지 못했습니다.');
  } catch (error) {
    if (settings === settingsVersion) errors.set(id, error.message);
  }
}

async function sendPending() {
  if (running || experienceMode || !dispatchKey) return;
  running = true;
  const version = generation;
  const settings = settingsVersion;
  const key = dispatchKey;
  try {
    for (const task of queue) {
      if (version !== generation) break;
      const role = roleOf(task);
      const email = assignments[role]?.email;
      if (email && Object.hasOwn(workMailRoutes, `${typeOf(task)}/${role}`)) await dispatch(task, role, email, key, version, settings);
    }
    if (version === generation) {
      status.textContent = errors.size
        ? `메일 확인 필요 · ${[...new Set(errors.values())].join(' · ')}`
        : `자동 발송 켜짐 · 이 브라우저에서 발송 요청 ${sent.size}건 접수`;
    }
  } catch {
    status.textContent = '메일 요청을 준비하지 못했습니다. 이 화면을 새로고침하고 다시 시도하세요.';
  } finally {
    running = false;
    if (version !== generation) queueMicrotask(sendPending);
  }
}

export function updateMailQueue(tasks) {
  queue = tasks;
  generation++;
  queueMicrotask(sendPending);
}

for (const [key, label] of Object.entries(workRoles)) {
  const group = document.createElement('fieldset');
  const title = document.createElement('legend');
  title.textContent = label;
  group.append(title);
  for (const [field, caption, type] of [['name', '담당자 이름', 'text'], ['email', '받을 이메일', 'email']]) {
    const wrapper = document.createElement('label');
    wrapper.textContent = caption;
    const input = document.createElement('input');
    input.type = type;
    input.name = `${key}-${field}`;
    input.maxLength = field === 'email' ? 254 : 80;
    input.value = assignments[key]?.[field] ?? '';
    wrapper.append(input);
    group.append(wrapper);
  }
  roles.append(group);
}

byId('work-mail-live-settings').hidden = experienceMode;
stop.hidden = true;
if (experienceMode) status.textContent = '체험에서는 지정한 담당자를 표시합니다. 실제 메일은 일반 검토에서 보냅니다.';
else status.textContent = '자동 발송 꺼짐 · 담당자와 발송 키를 입력해 활성화하세요.';

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData(form);
  const key = (values.get('dispatch-key') ?? '').trim();
  const updated = {};
  for (const role of Object.keys(workRoles)) {
    const name = values.get(`${role}-name`).trim();
    const email = values.get(`${role}-email`).trim().toLowerCase();
    if (email && !validWorkEmail(email)) {
      status.textContent = `${workRoles[role]} 담당자 이메일을 확인하세요.`;
      return;
    }
    if (name || email) updated[role] = { name, email };
  }
  if (key && (key.length < 24 || !Object.values(updated).some(({ email }) => email))) {
    status.textContent = '자동 발송을 켜려면 발송 키와 받을 이메일을 입력하세요.';
    return;
  }
  scope ??= crypto.randomUUID();
  if (!saveState('work-mail-scope', scope) || !saveState('work-mail-assignments', updated)) {
    status.textContent = '담당자 설정을 브라우저에 저장하지 못했습니다.';
    return;
  }
  assignments = updated;
  settingsVersion++;
  if (key) {
    dispatchKey = key;
    form.elements['dispatch-key'].value = '';
  }
  stop.hidden = !dispatchKey;
  errors.clear();
  attempted.clear();
  status.textContent = dispatchKey ? '담당자를 저장했습니다. 열린 작업의 발송을 확인하고 있습니다.'
    : '담당자를 저장했습니다. 자동 발송을 켜려면 발송 키를 입력하세요.';
  if (experienceMode) status.textContent = '체험용 담당자를 저장했습니다.';
  document.dispatchEvent(new Event('corevia:work-mail-settings'));
});

stop.addEventListener('click', () => {
  dispatchKey = '';
  settingsVersion++;
  generation++;
  form.elements['dispatch-key'].value = '';
  stop.hidden = true;
  form.elements['dispatch-key'].focus();
  status.textContent = '자동 발송을 껐습니다.';
});
