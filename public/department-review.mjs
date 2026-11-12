import { requestFeedback } from './ai-client.mjs';
import { supplyChecks } from './capacity-plan.mjs?v=followup-demo-1';
import { setWorkflowReview, recordDepartmentDecision, recordSupplyCheck, buyerChangeFeedback } from './proposal-workflow.mjs?v=work-mail-2';
import { loadState, saveState } from './workflow-storage.mjs?v=hands-on-demo-1';
import { choiceField, setInboxTasks, textField } from './work-inbox.mjs';

const byId = (id) => document.getElementById(id);
const section = byId('department-review-content');
const form = byId('department-form');
const roles = ['영업', '생산관리', '재무·전략'];
const decisions = { accepted: '수락', conditional: '조건부 수락', revise: '보완 요청', rejected: '반려' };
let active;
const restored = loadState('department');
let latest = restored ? { ...restored, reviews: new Map(restored.reviews) } : null;
let editRow;
let suggestion;
const feedbackRow = byId('feedback-row');
const feedbackStatus = byId('feedback-status');
const applyButton = byId('feedback-apply');

function persistReview() {
  saveState('department', { ...latest, reviews: [...latest.reviews] });
}

function renderSupplyChecks() {
  const plan = active;
  byId('supply-checks').hidden = !plan.checks.length;
  const items = plan.checks.map((check, index) => {
    const item = document.createElement('article');
    const heading = document.createElement('h4');
    heading.textContent = `${check.week} 주차 · ${check.product} · ${check.owner}`;
    const detail = document.createElement('p');
    detail.textContent = check.task;
    item.append(heading, detail);
    if (check.evidence) {
      const result = document.createElement('p');
      result.textContent = `확인 완료 · ${check.person} · ${check.evidence}`;
      item.append(result);
      return item;
    }
    const form = document.createElement('form');
    const inputs = ['확인 담당자', '근거 및 확인 결과'].map((text) => {
      const label = document.createElement('label');
      label.textContent = text;
      const input = document.createElement('input');
      input.required = true;
      input.maxLength = text === '확인 담당자' ? 80 : 500;
      label.append(input);
      form.append(label);
      return input;
    });
    const button = document.createElement('button');
    button.type = 'submit';
    button.textContent = '확인 완료 기록';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    form.append(button, status);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (active !== plan) return;
      const [person, evidence] = inputs.map((input) => input.value.trim());
      if (!person || !evidence) {
        status.textContent = '담당자와 확인 근거를 입력하세요.';
        return;
      }
      const resolved = { ...check, person, evidence };
      const checks = plan.checks.map((entry, position) => position === index ? resolved : entry);
      if (!saveState('department', { ...latest, checks, reviews: [...latest.reviews] })) {
        status.textContent = '확인 근거를 저장하지 못했습니다.';
        return;
      }
      plan.checks = checks;
      recordSupplyCheck(plan.version, resolved);
      renderReview();
    });
    item.append(form);
    return item;
  });
  byId('supply-check-list').replaceChildren(...items);
}

export function setReviewPlan(plan, onEditRow, edited = false) {
  section.hidden = !plan;
  byId('department-empty').hidden = Boolean(plan);
  editRow = onEditRow;
  suggestion = null;
  applyButton.hidden = true;
  feedbackStatus.textContent = '';
  byId('department-notice').textContent = '';
  if (!plan) {
    active = null;
    setInboxTasks('departments');
    if (edited && latest?.signature) {
      latest.signature = null;
      latest.reviews.clear();
      persistReview();
    }
    setWorkflowReview(null);
    return;
  }
  const signature = JSON.stringify(plan);
  if (latest?.signature !== signature) {
    latest = { signature, version: (latest?.version ?? 0) + 1, reviews: new Map(), checks: supplyChecks(plan.plans), ...plan };
    form.reset();
    persistReview();
  }
  active = latest;
  active.checks ??= supplyChecks(active.plans);
  feedbackRow.replaceChildren(...active.plans.map((row, index) =>
    new Option(`${row.week} · ${row.product} · ${row.plant}/${row.line}`, index)));
  renderReview();
  return active.version;
}

function renderReview() {
  byId('department-status').textContent = `${active.customer || '입찰 검토 건'} · 접수 검수 ${active.intakeVersion} · 공급안 버전 ${active.version}`;
  const list = byId('department-decisions');
  list.replaceChildren();
  for (const role of roles) {
    const item = document.createElement('li');
    const review = active.reviews.get(role);
    item.textContent = review
      ? `${role} · ${review.person} · ${decisions[review.decision]}${review.feedback ? ` · ${review.feedback}` : ''}${review.closure ? ` · 보완 종료 근거 ${review.closure.evidence}` : ''}`
      : `${role} · 검수 대기`;
    list.append(item);
  }
  const next = [];
  const total = (read) => active.plans.reduce((sum, row) => sum + read(row), 0).toLocaleString('ko-KR');
  setInboxTasks('departments', active.needsRecalculation ? [] : roles.flatMap((role) => {
    const previous = active.reviews.get(role);
    if (previous?.decision === 'accepted') return [];
    const requiresFinance = role === '재무·전략' && active.requiresFinanceEvidence;
    return [{
      id: `department/${active.version}/${role}/${previous?.decidedAt ?? ''}`, owner: role, title: `공급안 ${active.version} 검수`,
      detail: `${active.customer || '입찰'} · 제안 ${total((row) => row.revised.proposal)} EA · 기존 납품 부족 ${total((row) => row.revised.existingShortage)} EA · 신규 미충족 ${total((row) => row.unmetRequest)} EA`
        + (previous ? `\n보완 요청 · ${previous.feedback}` : '')
        + (requiresFinance ? '\n수락하려면 증분원가와 지급·수금 조건의 근거를 각각 기록하세요. 자료가 없으면 보완을 요청하세요.' : ''),
      fields: [textField('person', '담당자'), choiceField('decision', '검수 결정', Object.entries(decisions)),
        textField('feedback', '조건·보완 사유 또는 의견', { multiline: true, optional: true }),
        ...(previous ? [textField('closureEvidence', '보완을 닫은 근거', { multiline: true, optional: true })] : []),
        ...(requiresFinance ? [textField('cost', '증분원가 근거', { optional: true }),
          textField('cash', '지급·수금 근거', { optional: true })] : [])],
      submit(values) { return saveDepartmentDecision({ ...values, role }); },
    }];
  }));
  form.hidden = Boolean(active.needsRecalculation);
  if (active.needsRecalculation) next.push('바이어 변경 요청을 반영하고 모듈 2에서 새 공급안을 계산하세요.');
  if (active.plans.some(({ revised }) => revised.existingShortage > 0)) {
    next.push('생산관리 · 기존 고객 납품 부족을 해소할 복구안을 검토하세요.');
  }
  if (active.plans.some(({ shipping }) => shipping?.restricted > 0 || shipping?.shortage > 0)) {
    next.push('물류 · 출고 예약 때문에 제안량이 줄었습니다. 추가 출고 여력 또는 바이어의 변경 납품표를 확인하세요.');
  }
  if (active.plans.some(({ unmetRequest }) => unmetRequest > 0)) {
    next.push('영업 · 신규 요청 미충족분의 물량·납기 조정 가능 여부를 확인하세요.');
  }
  const revisions = roles.filter((role) => {
    const review = active.reviews.get(role);
    return review && review.decision !== 'accepted';
  });
  if (revisions.length) next.push(`${revisions.join(', ')} 회신 조건을 확인하고 수정안을 다시 계산하세요.`);
  if (roles.every((role) => active.reviews.get(role)?.decision === 'accepted')) {
    next.push('세 부서가 같은 공급안 버전을 수락했습니다.');
  }
  byId('department-next').textContent = next.join(' ');
  renderSupplyChecks();
  updateClosureField();
  const prices = { 'PL-01': 11.8, 'PL-02': 15.8 };
  const reference = active.customer?.toUpperCase() === 'C-201' && active.plans.every((row) => prices[row.product]);
  const revenue = (key) => Math.round(active.plans.reduce((sum, row) =>
    sum + row[key].proposal * prices[row.product] * 1478.29, 0)).toLocaleString('ko-KR');
  byId('finance-comparison').textContent = reference
    ? `RFP 단가 PL-01 USD 11.80 / PL-02 USD 15.80, 6월 30일 환율 1,478.29원 기준. 제안 환산 매출 ${revenue('baseline')} → ${revenue('revised')}원. 증분원가와 지급·수금 조건은 재무 확인이 필요합니다.`
    : '품목별 단가, 환율, 증분원가와 지급·수금 조건을 재무에서 확인하세요.';
  setWorkflowReview(active, roles, () => {
    active.needsRecalculation = true;
    active.reviews.clear();
    persistReview();
    renderReview();
  });
}

function updateClosureField() {
  const role = byId('department-role').value;
  const previous = active?.reviews.get(role);
  const accepted = byId('department-decision').value === 'accepted';
  const required = Boolean(previous && previous.decision !== 'accepted' && accepted);
  byId('department-closure').hidden = !required;
  byId('department-closure-evidence').required = required;
  byId('department-closure-context').textContent = required ? `이 버전의 보완 사유 · ${previous.feedback}` : '';
  const finance = role === '재무·전략' && active?.requiresFinanceEvidence && accepted;
  byId('department-finance-evidence').hidden = !finance;
  for (const id of ['department-finance-cost', 'department-finance-cash']) byId(id).required = Boolean(finance);
}

for (const id of ['department-role', 'department-decision']) {
  byId(id).addEventListener('change', () => {
    byId('department-closure-evidence').value = '';
    updateClosureField();
  });
}

function saveDepartmentDecision({ role, person, decision, feedback, closureEvidence, cost, cash }) {
  if (!active || active.needsRecalculation) throw new Error('공급안이 바뀌었습니다. 현재 공급안을 다시 계산하세요.');
  if (!roles.includes(role) || !person || !Object.hasOwn(decisions, decision)) {
    throw new Error('부서, 담당자, 결정을 입력하세요.');
  }
  if (decision !== 'accepted' && !feedback) {
    throw new Error('검수 조건이나 보완·반려 사유를 입력하세요.');
  }
  const financeRequired = active.requiresFinanceEvidence && role === '재무·전략' && decision === 'accepted';
  if (financeRequired && (!cost || !cash)) throw new Error('수락하려면 증분원가와 지급·수금 근거를 모두 입력하세요.');
  const finance = financeRequired ? { cost, cash } : null;
  const previous = active.reviews.get(role);
  let closure;
  if (decision === 'accepted' && previous && previous.decision !== 'accepted') {
    if (!closureEvidence) throw new Error('보완을 닫은 근거를 입력하세요.');
    closure = { issue: previous.feedback, evidence: closureEvidence };
  } else if (decision === 'accepted') closure = previous?.closure;
  const reviews = new Map(active.reviews).set(role, {
    person, decision, feedback, decidedAt: new Date().toISOString(),
    ...(closure ? { closure } : {}), ...(finance ? { finance } : {}),
  });
  if (!saveState('department', { ...latest, reviews: [...reviews] })) throw new Error('검수 회신을 저장하지 못했습니다.');
  active.reviews = reviews;
  recordDepartmentDecision(active.version, role, person, decisions[decision],
    [feedback, closure && `보완 사유 ${closure.issue} · 종료 근거 ${closure.evidence}`,
      finance && `증분원가 ${finance.cost} · 지급·수금 ${finance.cash}`].filter(Boolean).join(' · '));
  form.reset();
  renderReview();
  return `공급안 버전 ${active.version}의 ${role} 결정을 기록했습니다.`;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = (id) => byId(`department-${id}`).value.trim();
  const notice = byId('department-notice');
  try {
    notice.textContent = saveDepartmentDecision({ role: value('role'), person: value('person'), decision: value('decision'),
      feedback: value('feedback'), closureEvidence: value('closure-evidence'),
      cost: value('finance-cost'), cash: value('finance-cash') });
  } catch (error) {
    notice.textContent = error.message;
  }
});

byId('department-edit').addEventListener('click', () => {
  const index = Number(feedbackRow.value);
  window.location.hash = 'capacity-entry';
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => editRow?.(index)));
});

function clearSuggestion() {
  suggestion = null;
  applyButton.hidden = true;
  feedbackStatus.textContent = '';
}

feedbackRow.addEventListener('change', clearSuggestion);
byId('department-feedback').addEventListener('input', clearSuggestion);

byId('feedback-analyze').addEventListener('click', async () => {
  const target = active;
  const index = Number(feedbackRow.value);
  const row = target?.plans[index];
  const getFeedback = () => byId('department-feedback').value.trim()
    || target?.reviews.get(byId('department-role').value)?.feedback
    || buyerChangeFeedback();
  const feedback = getFeedback();
  clearSuggestion();
  if (!row || !feedback) {
    feedbackStatus.textContent = '대상 행과 분석할 회신을 입력하세요.';
    return;
  }
  const button = byId('feedback-analyze');
  button.disabled = true;
  feedbackStatus.textContent = '회신에서 변경 후보를 찾고 있습니다.';
  try {
    const data = await requestFeedback(feedback, row, feedbackStatus);
    if (active !== target || Number(feedbackRow.value) !== index || getFeedback() !== feedback) return;
    const labels = { additional: '추가 확정 주문', reduction: '가용량 감소', requested: '신규 요청량' };
    if (Object.hasOwn(labels, data.field) && Number.isSafeInteger(data.value) && data.value >= 0) {
      feedbackStatus.textContent = `${row.week} · ${row.product} · ${labels[data.field]} ${row[data.field]} → ${data.value} EA · 근거 “${data.quote}” · ${data.reason}`;
      suggestion = { target, index, feedback, getFeedback, ...data };
      applyButton.hidden = false;
    } else feedbackStatus.textContent = data.reason;
  } catch (error) {
    if (active === target) feedbackStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

applyButton.addEventListener('click', () => {
  if (suggestion?.target !== active || suggestion.getFeedback() !== suggestion.feedback) return;
  const blocked = editRow?.(suggestion.index, suggestion);
  if (blocked) feedbackStatus.textContent = blocked;
});
