import { capacityTrace, compareCapacity, deliveryWeek, readQuantity, shippingRecords, verifyShippingEvidence } from './capacity-plan.mjs?v=allocation-audit-1';
import { verifyAllocation } from './capacity-verification.mjs';
import { renderSupplyDecision } from './supply-decision-view.mjs';
import { deliverySchedule } from './proposal-checks.mjs';
import { scenarios } from './capacity-scenarios.mjs';
import { setReviewPlan } from './department-review.mjs?v=work-mail-2';
import { recordShippingReply } from './proposal-workflow.mjs?v=work-mail-2';
import { changeExperience, loadState, saveState } from './workflow-storage.mjs?v=hands-on-demo-1';
import { choiceField, setInboxTasks, textField } from './work-inbox.mjs';

const byId = (id) => document.getElementById(id);
const form = byId('capacity-form');
const rows = byId('capacity-rows');
const result = byId('capacity-result');
const status = byId('capacity-status');
const shippingInput = byId('capacity-shipping');
const format = new Intl.NumberFormat('ko-KR');
const quantityFields = [
  ['capacity', '실효능력'], ['commitments', '기존 약속'], ['requested', '신규 요청'],
  ['additional', '추가 확정 주문'], ['reduction', '가용량 감소'],
];
let lines = [];
let intake;
let shippingReplies = {};

function snapshotShipping() {
  const context = intake.supplyContext;
  return (context?.weeks ?? []).flatMap(({ start, shipments }) => {
    const shipment = shipments.find(({ route }) => route === context.route);
    return shipment ? [`${start} | ${shipment.capacity} | ${shipment.booked} | 시연용 대시보드 · ${context.route}`] : [];
  }).join('\n');
}

function supplyEvidence(row) {
  const week = intake.supplyContext?.weeks.find(({ start }) => start === row.week);
  if (!week) return row;
  const product = week.products.find(({ code, line }) =>
    code === row.product && line.replaceAll(' ', '') === `${row.plant}/${row.line}`
  );
  if (!product) throw new Error(`${row.week} ${row.product}의 대시보드 제품·라인 근거를 확인하세요.`);
  if (deliveryWeek(row.deliveryDate) !== row.week) {
    throw new Error('대시보드의 주초 재고는 같은 주의 납품에만 적용합니다. 납품일 또는 주간 근거를 확인하세요.');
  }
  const stock = product.stock - product.hold;
  const end = new Date(`${row.week}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const output = row.deliveryDate >= end.toISOString().slice(0, 10) ? product.output : 0;
  return {
    ...row, capacity: stock + output, commitments: product.recurring + product.reserved,
    source: `시연용 대시보드 · 사용 가능 재고 ${stock} + 납품일 전 입고 ${output} · 확정 공급 ${product.recurring} + 별도 예약 ${product.reserved}${row.source ? ` · ${row.source}` : ''}`,
  };
}

function saveDraft() {
  updateEvidenceFields();
  invalidateCalculation(true);
  const saved = saveCapacity(false);
  status.textContent = '';
  syncShippingInbox();
  return saved;
}

function saveCapacity(calculated) {
  return saveState('capacity', {
    intakeVersion: intake.version, rows: currentRows(), shipping: shippingInput.value, shippingReplies, calculated,
  });
}

function shippingWeeks() {
  if (!intake?.buyerChangeId || intake.decision !== 'accepted' || !intake.conditions.deliveryEvidence) return [];
  return [...new Set(deliverySchedule(intake.conditions.deliverySchedule).map(({ date }) => deliveryWeek(date)))].sort();
}

function hasShippingReply(week, entry) {
  const answer = shippingReplies[week];
  return answer?.decision === 'confirmed' && entry
    && ['capacity', 'booked', 'source'].every((field) => entry[field] === answer[field]);
}

function syncShippingInbox() {
  const weeks = shippingWeeks();
  let records;
  try { records = shippingRecords(shippingInput.value); }
  catch { records = new Map(); }
  setInboxTasks('shipping', weeks.flatMap((week) => {
    const current = records.get(week);
    const previous = shippingReplies[week];
    if (hasShippingReply(week, current)) return [];
    return [{
      id: `shipping/${intake.version}/${week}/${previous?.answeredAt ?? ''}/${current?.capacity ?? ''}/${current?.booked ?? ''}/${current?.source ?? ''}`,
      owner: '물류', title: `${week} 주차 공동 출고 확인`,
      detail: `${intake.conditions.customer || '입찰'} · 수정 납품표에 적용할 공동 출고 한도와 기존 예약을 확인하세요.`
        + (current ? `\n현재 입력 · 한도 ${format.format(current.capacity)} EA · 예약 ${format.format(current.booked)} EA\n근거 · ${current.source}` : '')
        + (previous?.decision === 'unavailable' ? `\n이전 확인 불가 사유 · ${previous.evidence}` : ''),
      fields: [textField('person', '물류 담당자'), choiceField('decision', '회신 상태',
        [['confirmed', '한도와 예약 확인'], ['unavailable', '확인 불가']]),
      textField('capacity', '공동 출고 한도 (EA)', { quantity: true, optional: true }),
      textField('booked', '기존 예약 (EA)', { quantity: true, optional: true }),
      textField('evidence', '회신 증빙 또는 확인 불가 사유', { multiline: true })],
      submit(values) { return applyShippingReply(week, values); },
    }];
  }));
}

function applyShippingReply(week, { person, decision, capacity, booked, evidence }) {
  if (!shippingWeeks().includes(week)) throw new Error('납품표가 바뀌었습니다. 새 물류 요청을 열어 주세요.');
  if (!person || !evidence || !['confirmed', 'unavailable'].includes(decision)) throw new Error('담당자, 회신 상태와 근거를 입력하세요.');
  const answeredAt = new Date().toISOString();
  if (decision === 'unavailable') {
    shippingReplies = { ...shippingReplies, [week]: { decision, evidence, answeredAt } };
    if (!saveDraft()) throw new Error('회신을 저장하지 못했습니다.');
    recordShippingReply(week, person, `확인 불가 · ${evidence}`);
    return '확인 불가 사유를 기록했습니다. 해당 주차 물류 요청은 대기 상태입니다.';
  }
  const quantities = [capacity, booked].map(readQuantity);
  if (!quantities.every((quantity) => Number.isSafeInteger(quantity) && quantity >= 0)) {
    throw new Error('출고 한도와 기존 예약을 0 이상의 정수로 모두 입력하세요.');
  }
  const records = shippingRecords(shippingInput.value);
  const source = `${person} · ${evidence.replace(/\s+/g, ' ')}`.replaceAll('|', '／');
  const entry = { capacity: quantities[0], booked: quantities[1], source };
  records.set(week, entry);
  const untouched = rows.rows.length === 1 && currentRows().every((row) => !row.week && !row.source && row.requested === null);
  if (untouched && intake.supplyContext) {
    try { loadConfirmedSchedule(); }
    catch (error) { status.textContent = error.message; }
  }
  shippingInput.value = [...records].map(([date, item]) => `${date} | ${item.capacity} | ${item.booked} | ${item.source}`).join('\n');
  shippingReplies = { ...shippingReplies, [week]: { ...entry, decision, answeredAt } };
  if (!saveDraft()) throw new Error('물류 회신을 저장하지 못했습니다.');
  recordShippingReply(week, person, `한도 ${format.format(entry.capacity)} EA · 예약 ${format.format(entry.booked)} EA · ${source}`);
  if (shippingWeeks().some((date) => !hasShippingReply(date, records.get(date)))) {
    return '회신을 저장했습니다. 나머지 주차의 물류 회신을 기다립니다.';
  }
  form.requestSubmit();
  return result.hidden
    ? `회신을 저장했습니다. 생산계획의 주간 입력을 확인하세요.${status.textContent ? ` ${status.textContent}` : ''}`
    : '물류 회신을 반영해 재계산했습니다. 새 공급안의 부서 검수 요청을 열었습니다.';
}

function updateEvidenceFields() {
  for (const [index, input] of currentRows().entries()) {
    const row = rows.rows[index];
    const capacity = row.querySelector('[name="capacity"]');
    const commitments = row.querySelector('[name="commitments"]');
    const linked = intake.supplyContext?.weeks.some(({ start }) => start === input.week);
    capacity.readOnly = commitments.readOnly = Boolean(linked);
    if (linked) {
      try {
        const evidence = supplyEvidence(input);
        capacity.value = evidence.capacity;
        commitments.value = evidence.commitments;
      } catch {
        capacity.value = commitments.value = '';
      }
    }
  }
}

function invalidateCalculation(edited = false) {
  result.hidden = true;
  setReviewPlan(null, undefined, edited);
}

function currentRows() {
  return [...rows.rows].map((row) => {
    const value = (name) => row.querySelector(`[name="${name}"]`).value.trim();
    return {
      ...lines[Number(value('assignment'))],
      week: value('week'),
      deliveryDate: value('deliveryDate'),
      source: value('source'),
      ...Object.fromEntries(quantityFields.map(([name]) => {
        const raw = value(name);
        const quantity = readQuantity(raw);
        return [name, Number.isNaN(quantity) ? raw : quantity];
      })),
    };
  });
}

export function setCapacityIntake(record) {
  const sameBid = intake?.source === record.source && intake?.conditions.customer === record.conditions.customer
    && intake?.supplyContext?.route === record.supplyContext?.route;
  const carriedShipping = sameBid ? shippingInput.value : null;
  intake = record;
  byId('experience-shipping-change').hidden = !changeExperience || !record.buyerChangeId;
  const accepted = record.decision === 'accepted' || !record.decision;
  lines = accepted ? (record.evidence?.lines ?? []) : [];
  form.hidden = !lines.length;
  rows.replaceChildren();
  invalidateCalculation();
  status.textContent = '';
  byId('capacity-intake').textContent = !accepted
    ? '모듈 1의 검수 수락을 저장하면 계산을 시작할 수 있습니다.'
    : lines.length
      ? `${record.conditions.customer || '입찰 검토 건'} · 모듈 1 검수 버전 ${record.version} · 주별 독립 배정 · 단위 EA`
      : '조회된 제품과 라인이 필요합니다. 모듈 1에서 품목 코드를 확인하고 다시 검수 결과를 저장하세요.';
  byId('capacity-example').hidden = record.conditions.customer?.toUpperCase() !== 'C-201'
    || !lines.some(({ product }) => product === 'PL-01')
    || !lines.some(({ product }) => product === 'PL-02');
  byId('capacity-scenarios').hidden = byId('capacity-example').hidden;
  const context = record.supplyContext;
  const contextLabel = byId('capacity-supply-context');
  contextLabel.hidden = !context;
  contextLabel.textContent = context
    ? `시연용 대시보드 근거 연결 · ${context.selectedWeek} 주간부터 · ${context.route}. 연결된 주는 대시보드 재고·입고·기존 약속을 계산에 적용합니다. 입고 날짜가 없는 주간 생산량은 주말에만 가용하다고 가정합니다.`
    : '';
  byId('capacity-confirmed').hidden = !context;
  shippingInput.value = carriedShipping ?? snapshotShipping();
  const saved = loadState('capacity');
  shippingReplies = saved?.intakeVersion === record.version ? saved.shippingReplies ?? {} : {};
  if (!lines.length) {
    setInboxTasks('shipping');
    return;
  }
  if (saved?.intakeVersion === record.version && Array.isArray(saved.rows)) {
    shippingInput.value = saved.shipping ?? shippingInput.value;
    for (const row of saved.rows) addRow(row);
    updateEvidenceFields();
    if (saved.calculated) form.requestSubmit();
  } else {
    addRow();
    if (sameBid) saveDraft();
  }
  syncShippingInbox();
}

function appendCell(row, content) {
  const cell = row.insertCell();
  if (typeof content === 'string') cell.textContent = content;
  else cell.append(content);
}

function evidencePanel(plan, plans) {
  const trace = capacityTrace(plan, plans);
  const n = (value) => format.format(value);
  const details = document.createElement('details');
  const label = document.createElement('summary');
  label.textContent = `${plan.product} 계산 근거`;
  details.append(label);
  const lines = [
    `유효 공급능력 · ${n(plan.capacity)} − ${n(plan.reduction)} = ${n(trace.effective)} EA`,
    `기존 약속 · ${n(plan.commitments)} + ${n(plan.additional)} = ${n(trace.existing)} EA`,
    `생산 기준 배정 · min(${n(plan.requested)}, max(0, ${n(trace.effective)} − ${n(trace.existing)})) = ${n(trace.production)} EA`,
    plan.shipping
      ? `공동 출고 잔여 · max(0, ${n(plan.shipping.capacity)} − 예약 ${n(plan.shipping.booked)} − 앞선 품목 배정 ${n(trace.previouslyAllocated)}) = ${n(trace.shippingAvailable)} EA. 납품일과 품목 코드 순으로 배정합니다.`
      : '출고 근거 미입력 · 생산 기준 잠정치이며 승인 전에 출고 근거가 필요합니다.',
    `제안 ${n(plan.revised.proposal)} EA · 미충족 ${n(plan.requested)} − ${n(plan.revised.proposal)} = ${n(plan.unmetRequest)} EA · 기존 부족 ${n(plan.revised.existingShortage)} EA`,
    `생산·주문 근거 · ${plan.source}`,
    plan.shipping ? `출고 근거 · ${plan.shipping.source}` : '',
  ];
  const list = document.createElement('ol');
  for (const line of lines.filter(Boolean)) {
    const item = document.createElement('li');
    item.textContent = line;
    list.append(item);
  }
  details.append(list);
  return details;
}

function addInput(row, name, label, type, value, required = true) {
  const input = document.createElement('input');
  input.name = name;
  input.type = type === 'number' ? 'text' : type;
  input.required = required;
  input.value = value ?? '';
  input.setAttribute('aria-label', label);
  if (type === 'number') {
    input.inputMode = 'numeric';
    input.pattern = '[0-9]+';
    input.title = '0 이상의 정수를 숫자로만 입력하세요.';
  }
  appendCell(row, input);
}

function addRow(values = {}) {
  const row = rows.insertRow();
  addInput(row, 'week', '주 시작일', 'date', values.week);
  addInput(row, 'deliveryDate', '납품 예정일', 'date', values.deliveryDate, false);
  const select = document.createElement('select');
  select.name = 'assignment';
  select.setAttribute('aria-label', '제품과 라인');
  for (const [index, { product, plant, line }] of lines.entries()) {
    select.add(new Option(`${product} · ${plant}/${line}`, index));
  }
  if (values.product) select.value = lines.findIndex(({ product, line }) => product === values.product && (!values.line || values.line === line));
  appendCell(row, select);
  for (const [name, label] of quantityFields) {
    addInput(row, name, label, 'number', values[name] ?? (name === 'additional' || name === 'reduction' ? 0 : ''));
  }
  addInput(row, 'source', '회신 근거', 'text', values.source);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary';
  remove.textContent = '삭제';
  remove.addEventListener('click', () => {
    row.remove();
    saveDraft();
  });
  appendCell(row, remove);
}

byId('capacity-add').addEventListener('click', () => {
  addRow();
  saveDraft();
});

function loadConfirmedSchedule() {
  const schedule = deliverySchedule(intake.conditions.deliverySchedule);
  if (!schedule.length || !intake.conditions.deliveryEvidence) throw new Error('영업 검수에서 바이어가 확인한 납품표와 근거를 먼저 저장하세요.');
  const context = intake.supplyContext;
  if (schedule.some(({ date, product }) => {
    const week = context?.weeks.find(({ start }) => start === deliveryWeek(date));
    return !week?.products.some(({ code }) => code === product) || !lines.some((line) => line.product === product);
  })) throw new Error('대시보드에 해당 납품 주간·품목 근거가 없습니다. 확인된 주간 회신을 직접 입력하세요.');
  const keys = new Set(schedule.map(({ date, product }) => `${deliveryWeek(date)}/${product}`));
  if (keys.size !== schedule.length) throw new Error('현재 계산은 같은 품목의 주 내 복수 납품일을 지원하지 않습니다. 담당자에게 별도 검토를 요청하세요.');
  const seeded = schedule.map(({ date, product, quantity }) => ({
    ...supplyEvidence({ ...lines.find((line) => line.product === product), week: deliveryWeek(date), deliveryDate: date, requested: quantity }),
    source: intake.conditions.deliveryEvidence,
  }));
  rows.replaceChildren();
  seeded.forEach(addRow);
}

byId('capacity-confirmed').addEventListener('click', () => {
  try {
    loadConfirmedSchedule();
    saveDraft();
    status.textContent = '확정 납품표와 대시보드 근거를 연결했습니다. 물류 회신을 확인하고 계산하세요.';
  } catch (error) { status.textContent = error.message; }
});

const scenarioSelect = byId('capacity-scenario');
for (const scenario of scenarios) scenarioSelect.add(new Option(scenario.label, scenario.id));
function selectedScenario() {
  return scenarios.find(({ id }) => id === scenarioSelect.value);
}
function describeScenario() {
  byId('capacity-scenario-description').textContent = selectedScenario()?.question ?? '';
}
scenarioSelect.addEventListener('change', describeScenario);
describeScenario();
byId('capacity-load-scenario').addEventListener('click', () => {
  const scenario = selectedScenario();
  if (!scenario || byId('capacity-scenarios').hidden) return;
  rows.replaceChildren();
  for (const row of scenario.rows) addRow({ ...row, deliveryDate: row.deliveryDate ?? row.week });
  form.dispatchEvent(new Event('input'));
  status.textContent = `모의 데이터 적용 · ${scenario.label}`;
});
form.addEventListener('input', saveDraft);

byId('experience-shipping-change').addEventListener('click', () => {
  if (!changeExperience || !intake?.buyerChangeId) return;
  const entries = shippingInput.value.split('\n');
  const index = entries.findIndex((entry) => entry.split('|', 1)[0].trim() === '2026-07-27');
  const sample = '2026-07-27 | 56000 | 54000 | 체험용 물류 회신 SIM-LOG-002';
  if (entries[index] !== sample) {
    if (index >= 0) entries[index] = sample;
    else entries.push(sample);
    shippingInput.value = entries.filter((entry) => entry.trim()).join('\n');
    saveDraft();
  }
  status.textContent = '체험용 물류 회신을 채웠습니다. 공급 가능량 계산으로 새 공급안을 검증하세요.';
  shippingInput.focus();
});

byId('capacity-example').addEventListener('click', () => {
  rows.replaceChildren();
  invalidateCalculation();
  status.textContent = '';
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'];
  for (const [index, week] of weeks.entries()) {
    addRow({ week, deliveryDate: week, product: 'PL-01', capacity: 330000, commitments: [285000, 292000, 290000, 285000][index],
      requested: 40000, source: '시연용 영업·생산관리·바이어 모의 회신' });
    addRow({ week, deliveryDate: week, product: 'PL-02', capacity: 75000, commitments: [58000, 60000, 57000, 59000][index],
      requested: 15000, additional: index === 1 ? 9000 : 0, reduction: index === 1 ? 7000 : 0,
      source: '시연용 영업·생산관리·품질·바이어 모의 회신' });
  }
  saveDraft();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  invalidateCalculation();
  try {
    if (!rows.rows.length) throw new Error('계산할 주간 행을 추가하세요.');
    const inputs = currentRows();
    const shipping = shippingRecords(shippingInput.value);
    const requiresFinanceEvidence = Object.keys(shippingReplies).length > 0;
    const pendingShipping = requiresFinanceEvidence && shippingWeeks().find((week) => !hasShippingReply(week, shipping.get(week)));
    if (pendingShipping) throw new Error(`${pendingShipping} 주차의 물류 회신을 받은편지함에서 확인하세요.`);
    const dashboardShipping = shippingRecords(snapshotShipping());
    verifyShippingEvidence(inputs.map(({ deliveryDate }) => deliveryDate), shipping, dashboardShipping);
    const plans = compareCapacity(inputs.map(supplyEvidence), shipping, dashboardShipping);
    const audit = verifyAllocation(plans);
    if (audit.failures.length) throw new Error(`계산 검증 실패 · ${audit.failures.join(' · ')}`);
    const comparison = byId('capacity-comparison');
    comparison.replaceChildren();
    let shortage = 0;
    const totals = new Map();
    for (const plan of plans) {
      const { week, product, plant, line, baseline, revised, unmetRequest } = plan;
      const row = comparison.insertRow();
      appendCell(row, week);
      appendCell(row, plan.deliveryDate || '미확인');
      appendCell(row, `${product} · ${plant}/${line}`);
      for (const quantity of [baseline.proposal, revised.proposal, baseline.existingShortage, revised.existingShortage, unmetRequest]) {
        appendCell(row, format.format(quantity));
      }
      appendCell(row, evidencePanel(plan, plans));
      shortage += revised.existingShortage;
      const total = totals.get(product) ?? [0, 0];
      total[0] += baseline.proposal;
      total[1] += revised.proposal;
      totals.set(product, total);
    }
    const proposals = [...totals].map(([product, [before, after]]) =>
      `${product} 제안 ${format.format(before)} → ${format.format(after)} EA`);
    const action = shortage
      ? `기존 납품 ${format.format(shortage)} EA 부족 · 생산관리 복구안 검토 필요`
      : '입력한 주차의 기존 납품 부족 0 EA';
    byId('capacity-summary').textContent = [...proposals, action].join(' · ');
    byId('capacity-audit-status').textContent = audit.missingShipping
      ? `수량 대조 통과 · 출고 증빙 없는 후보 ${audit.missingShipping}건은 잠정치`
      : `수량 대조 통과 · ${plans.length}개 배정 행 · 공동 출고 ${audit.shippingWeeks.length}개 주차 확인`;
    const shippingOverbooked = plans.some(({ shipping }) => shipping?.shortage > 0);
    const shippingLimited = plans.some(({ shipping }) => shipping?.restricted > 0);
    const partial = plans.some(({ unmetRequest }) => unmetRequest > 0);
    const blocked = Boolean(shortage || shippingOverbooked || audit.missingShipping);
    renderSupplyDecision(byId('capacity-decision-card'), plans, {
      state: blocked ? 'blocked' : 'review',
      label: blocked ? '확약 보류' : partial ? '조건 조정 필요' : '검수 전 후보',
      reason: shortage ? '기존 납품 부족을 해소하고 다시 계산하세요.'
        : shippingOverbooked ? '기존 예약이 출고 한도를 초과합니다. 물류 복구안을 확인하세요.'
          : audit.missingShipping ? '출고 증빙이 없는 배정량은 잠정치입니다. 물류 근거를 확인하세요.'
            : shippingLimited ? '출고 한도로 제안 후보가 줄었습니다. 물류 여력을 다시 확인하거나 바이어에게 수량·일정 조정을 확인하세요.'
              : partial ? '생산 여력으로 요청을 모두 충족하기 어렵습니다. 자재·품질 근거와 조정할 물량을 확인하세요.'
                : '승인 전에 바이어 확인 납품표와 대조하고, 부서 검수를 진행하세요.',
    });
    status.textContent = '';
    result.hidden = false;
    saveCapacity(true);
    const version = setReviewPlan({ intakeVersion: intake.version, customer: intake.conditions.customer, plans,
      ...(requiresFinanceEvidence ? { requiresFinanceEvidence } : {}),
    }, focusRow);
    byId('capacity-audit-meta').textContent = `공급안 버전 ${version} · 접수 검수 ${intake.version} · 이번 계산 ${new Date().toLocaleString('ko-KR')} · 자료 기준일 ${intake.evidence?.asOf ?? '미기록'}`;
  } catch (error) {
    status.textContent = error.message;
  }
});

function focusRow(index, patch) {
  const row = rows.rows[index];
  if (!row) return;
  if (patch) {
    const input = row.querySelector(`[name="${patch.field}"]`);
    if (input.readOnly) return '대시보드 근거로 계산한 값입니다. 변경은 추가 확정 주문 또는 가용량 감소로 기록하세요.';
    input.value = patch.value;
    const source = row.querySelector('[name="source"]');
    source.value = `${source.value} · 담당자 확인 회신 “${patch.quote}”`;
    form.dispatchEvent(new Event('input'));
    form.requestSubmit();
  } else row.querySelector('input').focus();
}
