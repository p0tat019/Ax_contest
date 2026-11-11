import { requestFeedback } from './ai-client.mjs';

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
    latest = { signature, version: (latest?.version ?? 0) + 1, reviews: new Map(), ...plan };
    form.reset();
    persistReview();
  }
  active = latest;
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
      ? `${role} · ${review.person} · ${decisions[review.decision]}${review.feedback ? ` · ${review.feedback}` : ''}`
      : `${role} · 검수 대기`;
    list.append(item);
  }
  const next = [];
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

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!active || active.needsRecalculation) return;
  const role = byId('department-role').value;
  const person = byId('department-person').value.trim();
  const decision = byId('department-decision').value;
  const feedback = byId('department-feedback').value.trim();
  const notice = byId('department-notice');
  if (!roles.includes(role) || !person || !Object.hasOwn(decisions, decision)) {
    notice.textContent = '부서, 담당자, 결정을 입력하세요.';
    return;
  }
  if (decision !== 'accepted' && !feedback) {
    notice.textContent = '검수 조건이나 보완·반려 사유를 입력하세요.';
    return;
  }
  active.reviews.set(role, { person, decision, feedback });
  persistReview();
  recordDepartmentDecision(active.version, role, person, decisions[decision], feedback);
  renderReview();
  form.reset();
  notice.textContent = `공급안 버전 ${active.version}의 ${role} 결정을 기록했습니다.`;
});

byId('department-edit').addEventListener('click', () => {
  const index = Number(feedbackRow.value);
  window.location.hash = 'capacity';
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
import { setWorkflowReview, recordDepartmentDecision, buyerChangeFeedback } from './proposal-workflow.mjs';
import { loadState, saveState } from './workflow-storage.mjs';
