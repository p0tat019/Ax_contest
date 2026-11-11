import { drafts, modules } from './assistant-skills.mjs';
import { requestAssistant } from './ai-client.mjs';
import { loadState, saveState } from './workflow-storage.mjs';

const byId = (id) => document.getElementById(id);
const form = byId('assistant-form');
const answer = byId('assistant-answer');
const draft = byId('assistant-draft');
const actionButton = byId('assistant-action');
let pending;
const requests = loadState('data-requests') ?? [];

function visible(element) {
  return element && !element.closest('[hidden]');
}

function context() {
  const screen = Object.fromEntries(Object.entries(modules).map(([id, module]) => [
    id, module.context.map(byId).filter(visible).map((element) => element.innerText.trim().slice(0, 1100)).filter(Boolean),
  ]));
  const rows = visible(byId('capacity-form')) ? [...byId('capacity-rows').rows].map((row, index) => {
    const field = (name) => row.querySelector(`[name="${name}"]`);
    return {
      index, week: field('week').value, line: field('assignment').selectedOptions[0]?.textContent,
      ...Object.fromEntries(Object.keys(drafts.capacity).map((name) => [
        name, field(name).value === '' ? null : Number(field(name).value),
      ])),
    };
  }).slice(0, 40) : [];
  return { screen, rows };
}

function renderRequests() {
  const list = byId('assistant-requests');
  list.replaceChildren();
  for (const request of requests) {
    const item = document.createElement('li');
    item.textContent = `${request.owner} · ${request.subject} · ${request.detail} · 확인 대기`;
    list.append(item);
  }
  if (!requests.length) {
    const item = document.createElement('li');
    item.textContent = '저장된 자료 확인 요청이 없습니다.';
    list.append(item);
  }
}

function showAction(result, snapshot) {
  answer.textContent = result.answer;
  draft.hidden = true;
  actionButton.hidden = true;
  pending = { ...result, snapshot };
  if (result.skill === 'draft_data_request') {
    draft.textContent = `${result.owner} · ${result.subject}\n${result.detail}`;
    actionButton.textContent = '자료 확인 요청 저장';
    draft.hidden = actionButton.hidden = false;
  } else if (result.skill === 'draft_edit' && Object.hasOwn(drafts[result.module] ?? {}, result.field)) {
    const target = result.module === 'capacity' ? snapshot.rows[result.row] : null;
    draft.textContent = `${target ? `${target.week} · ${target.line}\n` : ''}${drafts[result.module][result.field]}\n${result.value}`;
    actionButton.textContent = '입력란에 초안 넣기';
    draft.hidden = actionButton.hidden = false;
  } else if (result.skill === 'open_module' && Object.hasOwn(modules, result.module)) {
    actionButton.textContent = `${modules[result.module].title} 열기`;
    actionButton.hidden = false;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = byId('assistant-question').value.trim();
  if (!message) return;
  const button = form.querySelector('button');
  if (button.disabled) return;
  pending = null;
  button.disabled = actionButton.hidden = draft.hidden = true;
  answer.textContent = '현재 업무 상태를 확인하고 있습니다.';
  const snapshot = context();
  try {
    const result = await requestAssistant(message, snapshot, byId('assistant-answer'));
    showAction(result, snapshot);
  } catch (error) {
    answer.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

actionButton.addEventListener('click', () => {
  if (!pending) return;
  if (pending.skill === 'draft_data_request') {
    const { owner, subject, detail } = pending;
    const next = [...requests, { owner, subject, detail, createdAt: new Date().toISOString() }];
    if (!saveState('data-requests', next)) {
      answer.textContent = '자료 확인 요청을 브라우저에 저장하지 못했습니다.';
      return;
    }
    requests.push(next.at(-1));
    renderRequests();
    answer.textContent = '자료 확인 요청을 저장했습니다.';
  } else if (pending.skill === 'open_module') {
    const target = byId(modules[pending.module].anchor);
    if (!visible(target)) {
      answer.textContent = '이 화면은 앞 단계가 완료되면 열립니다.';
      return;
    }
    window.location.hash = target.id;
  } else if (pending.skill === 'draft_edit') {
    if (JSON.stringify(context()) !== JSON.stringify(pending.snapshot)) {
      answer.textContent = '업무 상태가 바뀌었습니다. 현재 상태에서 수정 초안을 다시 요청하세요.';
      return;
    }
    const target = pending.module === 'capacity'
      ? byId('capacity-rows').rows[pending.row]?.querySelector(`[name="${pending.field}"]`)
      : byId(pending.field);
    if (!visible(target) || target.disabled) {
      answer.textContent = '이 입력란은 해당 업무 단계에서 열립니다.';
      return;
    }
    target.value = pending.value;
    target.dispatchEvent(new Event('input', { bubbles: true }));
    window.location.hash = modules[pending.module].anchor;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => target.focus()));
    answer.textContent = '입력란에 초안을 넣었습니다. 값을 확인한 뒤 해당 화면에서 다음 단계를 진행하세요.';
  }
  pending = null;
  actionButton.hidden = draft.hidden = true;
});

renderRequests();
