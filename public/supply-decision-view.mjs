import { summarizeSupply } from './capacity-verification.mjs';

const number = new Intl.NumberFormat('ko-KR');
const ea = (value) => `${number.format(value)} EA`;

export function renderSupplyDecision(element, plans, decision) {
  element.hidden = !plans.length;
  if (!plans.length) {
    element.replaceChildren();
    return;
  }
  const totals = summarizeSupply(plans);
  const { requested, production, shippingLoss, proposal, existingShortage, missingShipping } = totals;
  const heading = document.createElement('h3');
  heading.textContent = '공급안 판단 요약';
  const state = document.createElement('span');
  state.className = 'supply-decision-state';
  state.dataset.state = decision.state;
  state.textContent = decision.label;
  const header = document.createElement('header');
  header.append(heading, state);
  const values = document.createElement('dl');
  const facts = [
    ['기존 납품 부족', ea(existingShortage), existingShortage ? '기존 납품 복구 검토' : '계산에 반영한 기존 약속 충족'],
    ['생산 기준 후보', ea(production), `신규 요청 ${ea(requested)}`],
    ['공동 출고 차감', ea(shippingLoss), missingShipping ? '출고 증빙 누락 포함' : '기존 예약을 반영한 감소분'],
    [decision.state === 'approved' ? '승인된 제안량' : '최종 제안 후보', ea(proposal), decision.state === 'approved' ? '승인 버전 기준 · 모의 제안' : '확약 전 검토 수량'],
  ];
  for (const [label, value, note] of facts) {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = label;
    const amount = document.createElement('dd');
    amount.textContent = value;
    const context = document.createElement('small');
    context.textContent = note;
    amount.append(context);
    item.append(term, amount);
    values.append(item);
  }
  const reason = document.createElement('p');
  reason.textContent = decision.reason;
  element.replaceChildren(header, values, reason);
}
