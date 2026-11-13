import { example, extractConditions, fields, pendingTasks } from './intake-rules.mjs';
import { lookupEvidence } from './intake-lookup.mjs';
import { setCapacityIntake } from './capacity.mjs?v=workflow-pages-1';
import { pendingBuyerChange, setWorkflowIntake } from './proposal-workflow.mjs?v=workflow-pages-1';
import { experienceMode, handsOnExperience, loadState, saveState } from './workflow-storage.mjs?v=hands-on-demo-1';
import { deliverySchedule } from './proposal-checks.mjs';

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
  byId(['deliverySchedule', 'deliveryEvidence'].includes(key) ? 'buyer-change-fields' : 'fields').append(field);
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
  byId('review-empty').hidden = true;
  void runLookup();
}

function showResult(record) {
  setWorkflowIntake(record);
  setCapacityIntake(record);
  renderBuyerChange();
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
function renderBuyerChange() {
  const pending = pendingBuyerChange();
  const context = byId('buyer-change-context');
  context.hidden = !pending;
  byId('buyer-change-decision').hidden = !pending;
  byId('hands-on-buyer-evidence').hidden = !pending || !handsOnExperience;
  byId('buyer-change-fill-status').hidden = true;
  context.textContent = pending
    ? `${pending.owner} · ${pending.deadline}까지 확인 · ${pending.content} · 아래 납품표와 새 증빙을 확인한 뒤 영업 검수를 저장하세요.`
    : '';
}

byId('hands-on-buyer-evidence').addEventListener('click', () => {
  if (!handsOnExperience || !pendingBuyerChange()) return;
  inputs.get('deliverySchedule').value = '2026-08-02 PL-01 1500; 2026-08-02 PL-02 500';
  const proof = inputs.get('deliveryEvidence');
  proof.value = 'SIM-BUYER-002 · 모의 바이어 감량 동의 회신';
  proof.dispatchEvent(new Event('input', { bubbles: true }));
  const status = byId('buyer-change-fill-status');
  status.textContent = '납품표와 새 증빙을 채웠습니다. 값을 확인한 뒤 영업 검수를 저장하세요.';
  status.hidden = false;
  inputs.get('deliverySchedule').focus();
});

window.addEventListener('corevia:buyer-change', () => {
  if (!saved) return;
  if (request.value !== saved.source || review.hidden) {
    request.value = saved.source;
    supplyContext = saved.supplyContext;
    showDraft(saved.conditions);
  }
  renderBuyerChange();
});
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
  if (!handsOnExperience) {
    supplyContext = undefined;
    byId('intake-screening').hidden = true;
  }
  review.hidden = true;
  byId('review-empty').hidden = false;
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
  const conditions = extractConditions(request.value);
  if (!Object.values(conditions).some(Boolean)) {
    notice.textContent = '확인할 입찰 조건을 찾지 못했습니다. 요청 요약이라면 “요청 고객: C-201”, “품목 및 요청 물량: PL-01 1000 EA”처럼 항목명과 값을 입력하세요.';
    request.focus();
    return;
  }
  showDraft(conditions);
  notice.textContent = '조건 초안을 만들었습니다. 담당자 검수 후 저장할 수 있습니다.';
}

byId('example').addEventListener('click', () => {
  supplyContext = undefined;
  byId('intake-screening').hidden = true;
  request.value = example;
  extractDraft();
  if (!review.hidden) location.hash = 'review';
});
byId('extract').addEventListener('click', () => {
  extractDraft();
  if (!review.hidden) location.hash = 'review';
});
document.addEventListener('corevia:open-bid', ({ detail: { source, summary, context, sample, rawOnly } }) => {
  supplyContext = context;
  byId('intake-screening-summary').textContent = summary;
  byId('intake-screening').hidden = false;
  if (handsOnExperience && rawOnly) {
    request.value = source;
    request.dispatchEvent(new Event('input', { bubbles: true }));
    byId('reviewer').value = '체험 영업 담당자';
    notice.textContent = '예시를 채웠습니다. 필요한 값을 수정하고 조건 추출·내부 자료 조회를 누르세요.';
    request.focus();
    return;
  }
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
    location.hash = 'review';
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
  const pending = request.value === saved?.source ? pendingBuyerChange() : null;
  const acceptingChange = pending && decision.value === 'accepted';
  if (decision.value === 'accepted') {
    const field = !conditions.customer ? 'customer' : !evidence.lines?.length ? 'products' : null;
    if (field) {
      saveNotice.textContent = field === 'customer' ? '요청 고객을 확인하세요.' : '내부 자료에서 조회되는 요청 품목 코드를 확인하세요.';
      inputs.get(field).focus();
      return;
    }
    try {
      if (conditions.deliverySchedule && !deliverySchedule(conditions.deliverySchedule).length) throw new Error('확정 납품표에는 한 줄 이상의 날짜·품목·수량이 필요합니다.');
    } catch (error) {
      saveNotice.textContent = error.message;
      inputs.get('deliverySchedule').focus();
      return;
    }
  }
  const previous = saved?.source === request.value ? saved.conditions : null;
  if (acceptingChange && (!conditions.deliverySchedule || !conditions.deliveryEvidence
    || conditions.deliveryEvidence === previous.deliveryEvidence)) {
    saveNotice.textContent = '변경 회신을 닫으려면 확인된 납품표와 새 회신 증빙을 함께 입력하세요.';
    inputs.get(conditions.deliverySchedule ? 'deliveryEvidence' : 'deliverySchedule').focus();
    return;
  }
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
  if (acceptingChange) {
    record.buyerChangeId = pending.id ?? pending.content;
    record.conditionEvidence.deliverySchedule = {
      source: conditions.deliveryEvidence, owner: reviewer, reply: pending.content,
      previous: previous.deliverySchedule || '미확인', value: conditions.deliverySchedule,
    };
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
  location.hash = record.decision === 'accepted' ? 'capacity-entry' : 'result';
});

byId('review-form').dataset.ready = 'true';
byId('example').disabled = false;
byId('extract').disabled = false;
document.dispatchEvent(new Event('corevia:intake-ready'));
