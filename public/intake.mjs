import { example, extractConditions, fields, pendingTasks } from './intake-rules.mjs';
import { lookupEvidence } from './intake-lookup.mjs';
import { setCapacityIntake } from './capacity.mjs';
import { setWorkflowIntake } from './proposal-workflow.mjs';
import { experienceMode, loadState, saveState } from './workflow-storage.mjs';

const byId = (id) => document.getElementById(id);
const request = byId('request');
const review = byId('review');
const decision = byId('decision');
const reason = byId('reason');
const notice = byId('notice');
const saveNotice = byId('save-notice');
const inputs = new Map();
const fieldStatuses = new Map();
const decisions = { accepted: '검수 수락', 'needs-information': '보완 요청', rejected: '반려' };
const buyerConditions = new Map([
  ['초도 납품일', 'firstDelivery'],
  ['분할 납품 조건', 'splitDelivery'],
  ['확정 납품표', 'deliverySchedule'],
  ['입찰 마감', 'deadline'],
  ['정확한 입찰 마감일', 'deadline'],
]);
let evidence = null;
let lookupVersion = 0;
let extracted = {};
let nextField;
let supplyContext;

function readConditions() {
  return Object.fromEntries([...inputs].map(([key, input]) => [key, input.value.trim()]));
}

function renderList(id, items, emptyText) {
  const list = byId(id);
  list.replaceChildren();
  for (const text of items.length ? items : [emptyText]) {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  }
}

function taskLabels(conditions) {
  return pendingTasks(conditions).map(({ label, owner, detail }) => `${label} · ${owner} · ${detail}`);
}

function reviewItem(list, title, detail, tag, sources = [], field) {
  const item = document.createElement('li');
  const heading = document.createElement('strong');
  heading.textContent = title;
  const badge = document.createElement('span');
  badge.className = 'review-tag';
  badge.textContent = tag;
  const body = document.createElement('p');
  body.textContent = detail;
  item.append(heading, badge, body);
  if (sources.length) {
    const source = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '조회 출처';
    source.append(summary, document.createTextNode(sources.join(' · ')));
    item.append(source);
  }
  if (inputs.has(field)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = '확인 값 입력';
    button.addEventListener('click', () => inputs.get(field).focus());
    item.append(button);
  }
  list.append(item);
}

function renderChecks(conditions) {
  const tasks = pendingTasks(conditions);
  byId('review-field-count').textContent = `${Object.values(conditions).filter(Boolean).length}/${fields.length}`;
  byId('review-task-count').textContent = `${tasks.length}건`;
  const list = byId('draft-tasks');
  list.replaceChildren();
  if (!tasks.length) reviewItem(list, '추가 확인 작업 없음', '조건과 근거를 확인한 뒤 검수 결정을 저장하세요.', '입력 완료');
  const pendingFields = new Set();
  for (const { label, owner, detail } of tasks) {
    const field = fields.find(([, name]) => name === label)?.[0] ?? buyerConditions.get(label)
      ?? (label === '지급 시점' ? 'payment' : undefined);
    if (inputs.has(field)) pendingFields.add(field);
    reviewItem(list, label, detail, owner, [], field);
  }
  nextField = [...pendingFields][0];
  byId('review-next-field').hidden = !nextField;
  byId('review-action-summary').textContent = pendingFields.size
    ? `노란색 ${pendingFields.size}개 항목에 확인한 내용을 입력하세요. 확인이 필요한 항목은 작업으로 남기고, 아래에서 담당자와 검수 결정을 입력할 수 있습니다.`
    : '공급 조건을 모두 입력했습니다. 아래에서 담당자와 검수 결정을 입력하세요.';
  for (const [key, status] of fieldStatuses) {
    const needsInput = pendingFields.has(key);
    status.textContent = needsInput
      ? (conditions[key] ? '직접 보완 필요' : '직접 입력 필요')
      : conditions[key] === extracted[key] ? '요청서에서 자동 추출' : '담당자 입력';
    inputs.get(key).closest('.condition-field').dataset.needsInput = String(needsInput);
  }
}

function updateDecisionRequirements() {
  const needsReason = decision.value === 'needs-information' || decision.value === 'rejected';
  reason.required = needsReason;
  byId('review-reason-required').hidden = !needsReason;
}

byId('review-next-field').addEventListener('click', () => inputs.get(nextField)?.focus());
decision.addEventListener('change', updateDecisionRequirements);

async function runLookup() {
  const version = ++lookupVersion;
  const conditions = readConditions();
  evidence = null;
  byId('review-evidence-count').textContent = '조회 중';
  byId('lookup-status').textContent = '내부 자료를 조회하고 있습니다.';
  byId('review-form').querySelector('[type="submit"]').disabled = true;
  renderChecks(conditions);
  byId('evidence').replaceChildren();
  try {
    const result = await lookupEvidence(conditions);
    if (version !== lookupVersion) return;
    evidence = result;
    const list = byId('evidence');
    for (const { product, plant, line, utilization, date, source } of result.lines) {
      reviewItem(list, `${product} · ${plant}/${line}`, `가동률 ${utilization}% · ${date}`, '생산라인', [source]);
    }
    const existing = result.existingCustomer;
    if (existing) {
      reviewItem(list, `${existing.customer} 출하 연결 미확인 ${existing.unlinkedOrders.toLocaleString('ko-KR')}건`,
        `주문 수량 ${existing.orderQuantity.toLocaleString('ko-KR')} EA · 확정 잔여 의무는 영업 확인 필요`,
        '주문 대사', existing.sources);
    }
    const count = result.lines.length + Number(Boolean(existing));
    byId('review-evidence-count').textContent = `${count}건`;
    byId('lookup-status').textContent = count
      ? `조회 완료 · 기준일 ${result.asOf}. 가동률은 주간 가용량 검수의 참고 자료입니다.`
      : '고객 또는 품목과 일치하는 내부 자료가 없습니다.';
  } catch {
    if (version !== lookupVersion) return;
    byId('lookup-status').textContent = '내부 자료 조회에 실패했습니다. 보완 요청 또는 반려를 기록할 수 있습니다.';
    byId('review-evidence-count').textContent = '조회 실패';
    byId('evidence').replaceChildren();
  } finally {
    if (version === lookupVersion) byId('review-form').querySelector('[type="submit"]').disabled = false;
  }
}

for (const [key, name] of fields) {
  const label = document.createElement('label');
  label.textContent = name;
  const input = document.createElement('input');
  input.placeholder = '미확인';
  if (key === 'deliverySchedule') input.placeholder = '2026-08-02 PL-01 10000; 2026-08-02 PL-02 6000';
  label.append(input);
  const status = document.createElement('span');
  status.className = 'field-status';
  const field = document.createElement('div');
  field.className = 'condition-field';
  field.append(label, status);
  byId('fields').append(field);
  inputs.set(key, input);
  fieldStatuses.set(key, status);
}

function showDraft(conditions) {
  extracted = extractConditions(request.value);
  for (const [key, input] of inputs) input.value = conditions[key] ?? '';
  decision.value = '';
  updateDecisionRequirements();
  reason.value = '';
  saveNotice.textContent = '';
  review.hidden = false;
  void runLookup();
}

function showResult(record) {
  setWorkflowIntake(record);
  setCapacityIntake(record);
  byId('result').hidden = false;
  byId('saved-conditions-heading').textContent = !record.decision || record.decision === 'accepted'
    ? '검수한 공급 조건' : '재검토할 공급 조건';
  byId('review-summary').textContent = `버전 ${record.version} · ${record.reviewer} · ${decisions[record.decision] ?? '검수 수락'} · ${new Date(record.savedAt).toLocaleString('ko-KR')}${record.reason ? ` · ${record.reason}` : ''}`;
  const conditions = byId('conditions');
  conditions.replaceChildren();
  for (const [key, label] of fields) {
    if (!record.conditions[key]) continue;
    const title = document.createElement('dt');
    const value = document.createElement('dd');
    title.textContent = label;
    value.textContent = record.conditions[key];
    const proof = record.conditionEvidence?.[key];
    if (proof) {
      const source = document.createElement('small');
      source.className = 'condition-proof';
      source.textContent = `근거 ${proof.source} · 확인 ${proof.owner}`;
      value.append(source);
    }
    conditions.append(title, value);
  }
  if (!conditions.childElementCount) {
    const empty = document.createElement('dd');
    empty.textContent = '확인된 조건이 없습니다.';
    conditions.append(empty);
  }
  const tasks = taskLabels(record.conditions);
  if (record.decision && !record.evidence) tasks.push('내부 자료 조회 재확인 · 영업');
  renderList('tasks', tasks, '추가 확인 작업이 없습니다.');
  const confirmedTasks = [...buyerConditions].filter(([label, key]) =>
    label !== '정확한 입찰 마감일' && record.conditions[key] && !tasks.some((task) => buyerConditions.get(task.split(' · ')[0]) === key))
    .map(([label]) => label);
  byId('buyer-updates').hidden = !confirmedTasks.length;
  renderList('buyer-updates-list', confirmedTasks, '');
  const followups = loadState('followups') ?? {};
  for (const [listId, entries] of [['tasks', tasks], ['buyer-updates-list', confirmedTasks]]) {
    for (const [index, task] of entries.entries()) {
      const item = byId(listId).children[index];
      const key = `${record.version}:${task}`;
      const condition = buyerConditions.get(task.split(' · ')[0]);
      const form = document.createElement('form');
      form.className = 'fields';
      const savedTask = followups[key] ?? {};
      const inputs = [
        ['owner', '담당자', 'text'], ['due', '확인 기한', 'date'], ['reply', '회신과 근거', 'text'],
        ...(condition ? [
          ['source', '회신 증빙 (메일 제목 또는 문서 번호)', 'text'],
          ['confirmedValue', '회신에서 확인한 공급 조건', ['splitDelivery', 'deliverySchedule'].includes(condition) ? 'text' : 'date'],
        ] : []),
      ].map(([name, labelText, type]) => {
        const label = document.createElement('label');
        label.textContent = labelText;
        const input = document.createElement('input');
        input.type = type;
        input.value = savedTask[name] ?? '';
        input.required = name === 'owner' || name === 'due';
        label.append(input);
        form.append(label);
        return [name, input];
      });
      const button = document.createElement('button');
      button.type = 'submit';
      button.textContent = '확인 작업 저장';
      const status = document.createElement('p');
      status.setAttribute('role', 'status');
      form.append(button, status);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        followups[key] = Object.fromEntries(inputs.map(([name, input]) => [name, input.value.trim()]));
        status.textContent = saveState('followups', followups)
          ? '저장했습니다. 확인된 값은 검수 초안에 반영하고 새 버전을 저장하세요.'
          : '확인 작업을 저장하지 못했습니다.';
      });
      if (condition) {
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'secondary';
        apply.textContent = '증빙과 조건 반영';
        apply.addEventListener('click', () => {
          const values = Object.fromEntries(inputs.map(([name, input]) => [name, input.value.trim()]));
          if (!form.reportValidity() || !values.owner || !values.reply || !values.source || !values.confirmedValue) {
            status.textContent = '담당자, 회신 내용, 증빙, 확인한 조건을 입력하세요.';
            return;
          }
          if (saved?.version !== record.version || request.value !== record.source) {
            status.textContent = '입찰 내용이 변경됐습니다. 현재 검수 버전에서 다시 확인하세요.';
            return;
          }
          const updated = {
            ...record,
            version: record.version + 1,
            savedAt: new Date().toISOString(),
            conditions: {
              ...record.conditions,
              [condition]: values.confirmedValue,
              ...(condition === 'deliverySchedule' ? { deliveryEvidence: `${values.source} · ${values.reply}` } : {}),
            },
            conditionEvidence: { ...record.conditionEvidence, [condition]: {
              source: values.source, owner: values.owner, reply: values.reply,
              previous: record.conditions[condition] || '미확인', value: values.confirmedValue,
            } },
          };
          try {
            if (!saveState('intake', updated)) throw new Error();
          } catch {
            status.textContent = '회신을 저장하지 못했습니다.';
            return;
          }
          saved = updated;
          showDraft(updated.conditions);
          showResult(updated);
          byId('review-summary').textContent += ' · 바이어 회신 반영, 공급안 재계산 및 부서 재검수 필요';
          byId('review-summary').scrollIntoView({ block: 'nearest' });
        });
        form.append(apply);
      }
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = '담당자·기한·회신 관리';
      details.append(summary, form);
      item.append(details);
    }
  }
}

let saved;
try {
  saved = loadState('intake');
  if (saved?.conditions && typeof saved.source === 'string') {
    request.value = saved.source;
    supplyContext = saved.supplyContext;
    byId('reviewer').value = saved.reviewer;
    showDraft(saved.conditions);
    showResult(saved);
  }
} catch {
  notice.textContent = '이 브라우저에서 이전 기록을 불러오지 못했습니다.';
}

request.addEventListener('input', () => {
  supplyContext = undefined;
  byId('intake-screening').hidden = true;
  review.hidden = true;
  ++lookupVersion;
  decision.value = '';
  notice.textContent = '';
});

function extractDraft() {
  if (!request.value.trim()) {
    notice.textContent = '입찰 요청을 입력하세요.';
    request.focus();
    return;
  }
  showDraft(extractConditions(request.value));
  notice.textContent = '조건 초안을 만들었습니다. 담당자 검수 후 저장할 수 있습니다.';
}

byId('example').addEventListener('click', () => {
  supplyContext = undefined;
  byId('intake-screening').hidden = true;
  request.value = example;
  extractDraft();
});
byId('extract').addEventListener('click', extractDraft);
document.addEventListener('corevia:open-bid', ({ detail: { source, summary, context, sample } }) => {
  supplyContext = context;
  byId('intake-screening-summary').textContent = summary;
  byId('intake-screening').hidden = false;
  if (request.value === source && !review.hidden) return;
  if (request.value !== source) {
    request.value = source;
    byId('reviewer').value = '';
    reason.value = '';
    decision.value = '';
  }
  if (experienceMode && sample) {
    showDraft({ ...extractConditions(source), deadline: '2026-07-22', firstDelivery: '2026-08-02',
      deliverySchedule: '2026-08-02 PL-01 10000; 2026-08-02 PL-02 6000',
      deliveryEvidence: '체험용 바이어 회신 SIM-BUYER-001', splitDelivery: '일괄 납품' });
    byId('reviewer').value = '체험 영업 담당자';
  } else extractDraft();
});
byId('review-form').addEventListener('input', (event) => {
  if ([...inputs.values()].includes(event.target)) {
    decision.value = '';
    updateDecisionRequirements();
    renderChecks(readConditions());
    if (event.target === inputs.get('customer') || event.target === inputs.get('products')) void runLookup();
  }
  saveNotice.textContent = '';
});
byId('review-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const reviewer = byId('reviewer').value.trim();
  if (!reviewer) {
    saveNotice.textContent = '검수 담당자를 입력하세요.';
    return;
  }
  if (review.hidden || !decisions[decision.value]) return;
  if (decision.value === 'accepted' && !evidence) {
    saveNotice.textContent = '내부 자료 조회가 완료되어야 검수를 수락할 수 있습니다.';
    return;
  }
  if (decision.value !== 'accepted' && !reason.value.trim()) {
    saveNotice.textContent = '보완 요청 또는 반려 사유를 입력하세요.';
    reason.focus();
    return;
  }
  const conditions = readConditions();
  const previous = saved?.source === request.value ? saved.conditions : null;
  if (decision.value === 'accepted' && previous?.deliverySchedule && conditions.deliverySchedule
    && conditions.deliveryEvidence === previous.deliveryEvidence
    && ['deliverySchedule', 'firstDelivery', 'splitDelivery'].some((key) => conditions[key] !== previous[key])) {
    saveNotice.textContent = '확정 납품표나 납품 조건을 변경하려면 새 바이어 회신 근거를 입력하세요.';
    inputs.get('deliveryEvidence').focus();
    return;
  }
  const record = {
    source: request.value,
    conditions,
    evidence,
    decision: decision.value,
    reason: reason.value.trim(),
    reviewer,
    version: (saved?.version ?? 0) + 1,
    savedAt: new Date().toISOString(),
  };
  if (record.conditions.customer?.toUpperCase() === supplyContext?.customer) record.supplyContext = supplyContext;
  if (saved?.source === record.source) {
    record.conditionEvidence = Object.fromEntries(Object.entries(saved.conditionEvidence ?? {})
      .filter(([key, proof]) => record.conditions[key] === proof.value));
  }
  try {
    if (!saveState('intake', record)) throw new Error();
  } catch {
    saveNotice.textContent = '브라우저에 저장할 수 없습니다. 저장소 권한을 확인하세요.';
    return;
  }
  saved = record;
  decision.value = '';
  updateDecisionRequirements();
  reason.value = '';
  showResult(record);
  saveNotice.textContent = '검수한 공급 조건과 확인 작업을 이 브라우저에 저장했습니다.';
});
