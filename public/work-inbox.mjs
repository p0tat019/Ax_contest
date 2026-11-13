import { experienceMode } from './workflow-storage.mjs?v=hands-on-demo-1';
import { assignedPerson, taskForMailLink, updateMailQueue } from './work-mail.mjs?v=dashboard-roles-1';

const byId = (id) => document.getElementById(id);
const dialog = byId('work-inbox');
const list = byId('work-inbox-list');
const response = byId('work-inbox-response');
const summary = byId('work-inbox-request');
const fields = byId('work-inbox-fields');
const notice = byId('work-inbox-notice');
const groups = new Map();
let opened;

export const textField = (name, label, extra = {}) => ({ name, label, ...extra });
export const choiceField = (name, label, options) => ({ name, label, options });

function tasks() {
  return [...groups.values()].flat();
}

function render() {
  const queue = tasks();
  byId('work-inbox-open').textContent = `${experienceMode ? '모의 받은편지함' : '업무 받은편지함'} · ${queue.length}`;
  list.replaceChildren(...queue.map((task) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    const person = assignedPerson(task);
    button.textContent = `${task.owner}${person ? ` (${person})` : ''} · ${task.title}`;
    item.append(button);
    button.addEventListener('click', () => openTask(task));
    return item;
  }));
  byId('work-inbox-empty').hidden = queue.length > 0;
  updateMailQueue(queue);
  if (opened && !queue.some(({ id }) => id === opened)) {
    response.hidden = true;
    summary.textContent = '공급안 또는 작업 상태가 바뀌었습니다. 받은편지함에서 새 요청을 선택하세요.';
    opened = null;
  }
}

function openTask(task) {
  notice.textContent = '';
  summary.textContent = task.detail;
  opened = task.id;
  if (task.href) {
    dialog.close();
    if (location.hash === task.href) document.querySelector(task.href)?.scrollIntoView();
    else location.hash = task.href;
    return;
  }
  fields.replaceChildren(...task.fields.map(({ name, label, options, multiline, optional, quantity }) => {
    const field = document.createElement('div');
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement(options ? 'select' : multiline ? 'textarea' : 'input');
    input.name = name;
    input.id = `work-inbox-field-${name}`;
    wrapper.htmlFor = input.id;
    input.required = !optional;
    if (name === 'person') input.value = assignedPerson(task);
    if (options) input.append(new Option('선택하세요', ''), ...options.map(([value, label]) => new Option(label, value)));
    else {
      input.maxLength = quantity ? 16 : 500;
      if (quantity) {
        input.inputMode = 'numeric';
        input.pattern = '[0-9]+';
      }
    }
    field.append(wrapper, input);
    return field;
  }));
  response.hidden = false;
  fields.querySelector('input, select, textarea')?.focus();
}

export function setInboxTasks(group, entries = []) {
  groups.set(group, entries);
  render();
}

function showInbox() {
  opened = null;
  response.hidden = true;
  summary.textContent = '';
  notice.textContent = '';
  render();
  if (!dialog.open) dialog.showModal();
}

async function openFromMail() {
  const hash = location.hash;
  if (!/^#work-mail-[a-f0-9]{64}$/.test(hash)) return;
  const task = await taskForMailLink(hash, tasks()).catch(() => null);
  if (hash !== location.hash) return;
  showInbox();
  const current = tasks().find(({ id }) => id === task?.id);
  if (current) openTask(current);
  else notice.textContent = '이 브라우저에서 현재 요청을 찾지 못했습니다. 작업이 완료됐거나 다른 브라우저에서 배정됐을 수 있습니다.';
}

{
  const button = byId('work-inbox-open');
  button.hidden = false;
  byId('work-inbox-title').textContent = experienceMode ? '모의 받은편지함' : '업무 받은편지함';
  button.addEventListener('click', showInbox);
  byId('work-inbox-mail-settings').addEventListener('click', (event) => {
    event.preventDefault();
    dialog.close();
    location.hash = 'work-mail-panel';
    requestAnimationFrame(() => byId('work-mail-heading').focus({ preventScroll: true }));
  });
  document.addEventListener('corevia:work-mail-settings', render);
  document.addEventListener('corevia:intake-ready', openFromMail, { once: true });
  window.addEventListener('hashchange', openFromMail);
  response.addEventListener('submit', (event) => {
    event.preventDefault();
    const task = tasks().find(({ id }) => id === opened);
    if (!task) return;
    const values = Object.fromEntries([...new FormData(response)].map(([name, value]) => [name, value.trim()]));
    try {
      const message = task.submit(values);
      opened = null;
      response.hidden = true;
      summary.textContent = '';
      notice.textContent = message;
      render();
      (list.querySelector('button') ?? byId('work-inbox-close')).focus();
    } catch (error) {
      notice.textContent = error.message;
    }
  });
  render();
}
