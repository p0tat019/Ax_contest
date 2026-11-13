import { experienceMode, loadState } from './workflow-storage.mjs?v=hands-on-demo-1';
import { fillSalesReviewExample } from './intake.mjs?v=complete-sales-example-1';

const byId = (id) => document.getElementById(id);
const roles = ['영업', '생산관리', '재무·전략'];
const sales = { person: '체험 영업 담당자', decision: 'accepted', reason: '모의 납품표의 수량·납기와 바이어 증빙을 대조했습니다.' };
const approval = { person: '체험 승인자', decision: 'approved', reason: '현재 공급안의 납기와 부서 검수 근거를 확인했습니다.' };
const cost = 'SIM-FIN-001 · 체험 증분원가 검토 완료';
const cash = 'SIM-FIN-002 · 체험 지급·수금 조건 검토 완료';

function fill(form, values) {
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = value;
    else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function reviewExample(role) {
  return {
    person: '체험 ' + role + ' 담당자', decision: 'accepted', feedback: '이번 공급안의 담당 부서 근거를 확인했습니다.',
    closureEvidence: 'SIM-REVIEW-002 · 보완 요청의 수정 근거를 다시 대조했습니다.', cost, cash,
  };
}

const actions = {
  sales(form) {
    if (fillSalesReviewExample()) fill(form, { reviewer: sales.person, decision: sales.decision, reason: sales.reason });
  },
  capacity() {
    const confirmed = byId('capacity-confirmed');
    if (!confirmed.hidden) confirmed.click();
    else if (!byId('capacity-example').hidden) byId('capacity-example').click();
  },
  department(form) {
    const reviews = new Map(loadState('department')?.reviews ?? []);
    const role = roles.find((name) => reviews.get(name)?.decision !== 'accepted') ?? byId('department-role').value;
    const example = reviewExample(role);
    fill(form, { 'department-role': role, 'department-person': example.person, 'department-decision': example.decision,
      'department-feedback': example.feedback });
    fill(form, {
      'department-closure-evidence': byId('department-closure').hidden ? '' : example.closureEvidence,
      'department-finance-cost': byId('department-finance-evidence').hidden ? '' : cost,
      'department-finance-cash': byId('department-finance-evidence').hidden ? '' : cash });
  },
  approval(form) {
    fill(form, { approver: approval.person, 'approval-decision': approval.decision, 'approval-reason': approval.reason });
  },
  reply(form) {
    fill(form, { 'reply-owner': sales.person, 'reply-type': 'received',
      'reply-content': 'SIM-BUYER-003 · 바이어가 이번 제안서를 접수했습니다.' });
  },
  roles(form) {
    for (const [key, label] of Object.entries({ sales: '영업', logistics: '물류', production: '생산관리', finance: '재무', approver: '승인' })) {
      fill(form, { [key + '-name']: '체험 ' + label + ' 담당자', [key + '-email']: key + '@example.com', [key + '-enabled']: true });
    }
  },
  task(form) {
    const { trialTask: type, trialOwner: role } = form.dataset;
    const example = type === 'shipping' ? {
      person: '체험 물류 담당자', decision: 'confirmed', capacity: '56000', booked: '54000', evidence: 'SIM-LOG-002 · 변경 예약 확인',
    } : type === 'approval' ? approval : reviewExample(role);
    fill(form, Object.fromEntries(Object.entries(example).filter(([name]) => form.elements.namedItem(name))));
  },
};

if (experienceMode) {
  for (const button of document.querySelectorAll('[data-trial-fill]')) {
    button.hidden = false;
    button.addEventListener('click', () => actions[button.dataset.trialFill](button.form));
  }
}
