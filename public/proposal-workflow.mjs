import { dateKey, proposalIssues } from './proposal-checks.mjs';
import { renderSupplyDecision } from './supply-decision-view.mjs';
import { choiceField, setInboxTasks, textField } from './work-inbox.mjs?v=guided-trial-1';
import { changeExperience, experienceMode, loadState, saveState } from './workflow-storage.mjs?v=hands-on-demo-1';

const byId = (id) => document.getElementById(id);
const value = (id) => byId(id).value.trim();
const approvalForm = byId('approval-form');
const replyForm = byId('buyer-reply-form');
const notice = byId('proposal-notice');
const history = loadState('history') ?? [];
let restored = loadState('proposal');
let intake;
let review;
let roles = [];
let reopenReview;
let approval;
let submitted;
let reply;
let reviewKey;
let changeRequest;

export function buyerChangeFeedback() {
  return changeRequest?.content ?? '';
}

export function pendingBuyerChange() {
  return changeRequest ?? restored?.changeRequest;
}

function renderList(id, entries) {
  byId(id).replaceChildren(...entries.map((entry) => {
    const item = document.createElement('li');
    item.textContent = entry;
    return item;
  }));
}

function record(message) {
  history.unshift(`${new Date().toLocaleTimeString('ko-KR')} · ${message}`);
  saveState('history', history);
}

function persistProposal() {
  saveState('proposal', { reviewKey, approval, submitted, reply, changeRequest });
}

export function recordDepartmentDecision(version, role, person, decision, feedback) {
  record(`공급안 ${version} · ${role} · ${person} · ${decision}${feedback ? ` · ${feedback}` : ''}`);
}

export function recordSupplyCheck(version, { week, product, owner, person, evidence }) {
  record(`공급안 ${version} · ${week} ${product} · ${owner} ${person} 확인 완료 · ${evidence}`);
}

export function recordShippingReply(week, person, detail) {
  record(`물류 회신 · ${week} · ${person} · ${detail}`);
  renderList('workflow-history', history);
}

export function setWorkflowIntake(recordedIntake) {
  const pending = pendingBuyerChange();
  if (pending && (recordedIntake.buyerChangeId === (pending.id ?? pending.content)
    || (pending.source && pending.source !== recordedIntake.source))) {
    changeRequest = null;
    if (restored) {
      restored.changeRequest = null;
      saveState('proposal', restored);
    } else persistProposal();
  }
  intake = recordedIntake;
  if (!history.some((entry) => entry.includes(` · 접수 검수 ${intake.version} ·`))) {
    record(`접수 검수 ${intake.version} · ${intake.conditions.customer || '입찰 검토 건'} · ${intake.reviewer}`);
    for (const proof of Object.values(intake.conditionEvidence ?? {})) {
      record(`접수 검수 ${intake.version} · ${proof.previous} → ${proof.value} · ${proof.source} · ${proof.owner}`);
    }
  }
  render();
}

export function setWorkflowReview(plan, departments = [], reopen) {
  review = plan;
  roles = departments;
  reopenReview = reopen;
  const key = plan && JSON.stringify([plan.intakeVersion, plan.version, [...plan.reviews], Boolean(plan.needsRecalculation)]);
  if (reviewKey !== key) {
    if (approval?.decision === 'approved') record(`공급안 ${approval.version} 승인 효력 종료 · 공급안 또는 부서 검수 변경`);
    approval = submitted = reply = null;
    approvalForm.reset();
    replyForm.reset();
    byId('reply-fill-status').hidden = true;
    notice.textContent = '';
    reviewKey = key;
    if (plan && restored) {
      if (restored.reviewKey === key) ({ approval, submitted, reply, changeRequest } = restored);
      restored = null;
    }
    if (plan || !restored) persistProposal();
  }
  render();
}

function blockReason() {
  if (!intake) return '영업 담당자가 입찰 요청을 접수하고 검수하세요.';
  if (intake.decision && intake.decision !== 'accepted') return '영업 검수에서 요청한 보완 사항을 확인하세요.';
  if (pendingBuyerChange()) return '변경 회신의 납품표와 증빙을 확인하고 새 영업 검수를 저장하세요.';
  if (!review) return '모듈 2에서 공급안을 계산하세요.';
  if (review.needsRecalculation) return '바이어 조건 변경 · 모듈 2에서 수정안을 다시 계산하세요.';
  if (review.plans.some(({ revised }) => revised.existingShortage > 0)) return '기존 고객 납품 부족을 해소하고 다시 계산하세요.';
  if (review.plans.some(({ shipping }) => shipping?.shortage > 0)) return '기존 예약이 출고 한도를 초과합니다. 물류 복구안을 확인하세요.';
  if (!review.plans.some(({ revised }) => revised.proposal > 0)) return '제안할 물량이 있는 공급안을 계산하세요.';
  if (proposalIssues(intake.conditions, review.plans).length) return '확정 납품표와 공급안의 날짜·수량·출고 근거를 확인하세요.';
  const pending = roles.filter((role) => review.reviews.get(role)?.decision !== 'accepted');
  if (review.requiresFinanceEvidence && !pending.includes('재무·전략')
    && !review.reviews.get('재무·전략')?.finance) return '재무 담당자가 증분원가와 지급·수금 근거를 확인하세요.';
  return pending.length ? `${pending.join(', ')} 검수 수락이 필요합니다.` : '';
}

function render() {
  const blocked = blockReason();
  const issues = intake && review ? proposalIssues(intake.conditions, review.plans) : [];
  const isApproved = !blocked && approval?.decision === 'approved';
  const held = Boolean(blocked || approval?.decision === 'returned' || approval?.decision === 'declined');
  const change = pendingBuyerChange();
  const finance = review?.reviews.get('재무·전략')?.finance;
  setInboxTasks('buyer', change ? [{
    id: `buyer/${change.id ?? change.content}`, owner: '영업', title: '변경 납품표와 바이어 증빙 확인', href: '#buyer-change-edit',
  }] : []);
  setInboxTasks('approval', !blocked && !approval ? [{
    id: `approval/${review.version}`, owner: 'CEO·이사회', title: `공급안 ${review.version} 참여 결정`,
    detail: `제안 ${review.plans.reduce((sum, row) => sum + row.revised.proposal, 0).toLocaleString('ko-KR')} EA · 기존 납품 부족 없음 · 부서 검수 완료`
      + (finance ? `\n증분원가 근거 · ${finance.cost}\n지급·수금 근거 · ${finance.cash}` : '')
      + `\n결제 ${intake.conditions.payment || '미확인'} · 지연 페널티 ${intake.conditions.penalty || '미확인'} · 회수 비용 ${intake.conditions.recall || '미확인'}`,
    fields: [textField('person', '승인 담당자'), choiceField('decision', '입찰 결정',
      [['approved', '참여 승인'], ['returned', '보완 요청'], ['declined', '참여 보류']]),
    textField('reason', '승인 조건 또는 결정 사유', { multiline: true }),
    textField('conditionalScope', '미확인 입찰 조건의 허용 근거와 범위', { multiline: true, optional: true })],
    submit(values) {
      saveApproval(values);
      return values.decision === 'approved' ? '참여 결정을 기록했습니다. 승인과 모의 제출에서 제안서를 확인하세요.'
        : '결정을 기록했습니다. 승인 화면에서 후속 조치를 확인하세요.';
    },
  }] : []);
  const handoff = isApproved && !submitted
    ? { id: `submission/${approval.version}`, title: '승인된 제안서 확인 및 모의 제출', href: '#proposal-document' }
    : submitted && !reply && !change
      ? { id: `reply/${submitted.version}`, title: '바이어 회신 기록', href: '#buyer-reply-form' }
      : null;
  setInboxTasks('handoff', handoff ? [{ ...handoff, owner: '영업' }] : []);
  renderSupplyDecision(byId('proposal-decision-card'), review && !review.needsRecalculation ? review.plans : [], {
    state: isApproved ? 'approved' : held ? 'blocked' : 'review',
    label: isApproved ? '참여 승인' : held ? '확약 보류' : '승인 결정 대기',
    reason: blocked || approval?.reason || '부서 검수를 마친 현재 버전의 입찰 참여를 결정하세요.',
  });
  renderList('proposal-issues', issues);
  const report = byId('decision-report');
  const heading = document.createElement('h3');
  heading.textContent = '의사결정 보고서';
  const list = document.createElement('dl');
  const sum = (read) => review.plans.reduce((amount, row) => amount + read(row), 0).toLocaleString('ko-KR') + ' EA';
  const facts = [
    ['공급안', review ? `버전 ${review.version} · ${review.needsRecalculation ? '재계산 필요' : '현재 계산'}` : '미산정'],
    ['제안량 · 신규 미충족', review && !review.needsRecalculation ? `${sum((row) => row.revised.proposal)} · ${sum((row) => row.unmetRequest)}` : '계산 필요'],
    ['기존 납기 위험', review && !review.needsRecalculation ? `기존 부족 ${sum((row) => row.revised.existingShortage)} · 입력된 확정 약속 기준` : '검증 필요'],
    ['경제성', review && !review.needsRecalculation ? byId('finance-comparison').textContent : '생산계획 계산 후 재무 검토'],
    ...(finance && !review.needsRecalculation ? [['재무 확인 근거', `증분원가 ${finance.cost} · 지급·수금 ${finance.cash}`]] : []),
    ['계약 위험', intake ? `결제 ${intake.conditions.payment || '미확인'} · 지연 페널티 ${intake.conditions.penalty || '미확인'} · 회수 비용 ${intake.conditions.recall || '미확인'}` : '입찰 요청서 확인 필요'],
    ['미해결 항목', issues.length ? issues.join(' · ') : blocked || '현재 승인 차단 항목 없음'],
    ['부서 검수', review ? roles.map((role) => `${role} ${review.reviews.get(role)?.decision === 'accepted' ? '수락' : '확인 필요'}`).join(' · ') : '검수 대기'],
    ['부서 보완 종료 근거', review ? roles.flatMap((role) => {
      const closure = review.reviews.get(role)?.closure;
      return closure ? [`${role} · 보완 ${closure.issue} · 확인 ${closure.evidence}`] : [];
    }).join(' / ') || '기록 없음' : '검수 대기'],
    ['공급 제약 확인 작업', review?.checks?.length
      ? review.checks.map((check) => `${check.week} ${check.owner} · ${check.evidence ? `${check.person} 확인 · ${check.evidence}` : '확인 대기'}`).join(' / ')
      : '현재 공급안에서 생성된 작업 없음'],
  ];
  for (const [label, content] of facts) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = content;
    list.append(dt, dd);
  }
  report.replaceChildren(heading, list);
  byId('proposal-issues').hidden = !issues.length;
  approvalForm.hidden = Boolean(blocked || approval);
  byId('proposal-document').hidden = Boolean(blocked || approval?.decision !== 'approved');
  byId('proposal-submit').disabled = Boolean(submitted);
  replyForm.hidden = !submitted || Boolean(reply);
  byId('experience-buyer-change').hidden = !changeExperience;
  byId('proposal-content').textContent = approval?.document ?? '';
  const evidence = byId('approval-evidence-list');
  byId('approval-evidence').open = Boolean(Object.keys(intake?.conditionEvidence ?? {}).length);
  evidence.replaceChildren();
  for (const [key, label] of [['deadline', '입찰 마감'], ['firstDelivery', '초도 납품일'], ['splitDelivery', '분할 납품 조건'],
    ['deliverySchedule', '확정 납품표'], ['deliveryEvidence', '납품표 확인 근거']]) {
    const title = document.createElement('dt');
    const description = document.createElement('dd');
    const proof = intake?.conditionEvidence?.[key];
    title.textContent = label;
    description.textContent = intake?.conditions[key] || '미확인';
    if (proof) description.textContent += `\n${proof.previous} → ${proof.value}\n근거 ${proof.source} · 확인 ${proof.owner}\n${proof.reply}`;
    evidence.append(title, description);
  }
  if (submitted && !value('reply-owner')) byId('reply-owner').value = reply?.owner ?? submitted.owner;
  if (submitted && !value('reply-date')) byId('reply-date').value = reply?.deadline ?? submitted.deadline;
  let status = blocked || 'CEO·이사회 입찰 결정 대기';
  if (approval) status = approval.decision === 'approved'
    ? `공급안 ${approval.version} 승인 · ${approval.person}`
    : `${approval.decision === 'returned' ? '보완 요청' : '참여 보류'} · ${approval.reason}`;
  if (submitted) status = `공급안 ${submitted.version} 모의 제출 완료 · ${submitted.owner} · ${submitted.deadline}까지 회신 확인`;
  if (reply) status = `바이어 접수 확인 · ${reply.owner} · 다음 확인 ${reply.deadline} · ${reply.content}`;
  byId('proposal-status').textContent = status;
  byId('submission-status').textContent = submitted ? '모의 제출을 기록했습니다.' : approval?.decision === 'approved' && !blocked ? '' : '입찰 참여 승인 후 제출할 수 있습니다.';
  byId('buyer-reply-status').textContent = submitted ? status : '모의 제출을 완료하면 바이어 회신을 기록할 수 있습니다.';
  byId('submitted-next').hidden = !submitted;
  renderList('workflow-steps', [
    `입찰 접수 · ${intake ? `검수 버전 ${intake.version} · ${{accepted:'수락', 'needs-information':'보완 요청', rejected:'반려'}[intake.decision] ?? '수락'}` : '대기'}`,
    `공급 가능량 · ${review ? `공급안 버전 ${review.version}` : '계산 대기'}`,
    `부서 검수 · ${review ? [...review.reviews.values()].filter((entry) => entry.decision === 'accepted').length : 0}/3 수락`,
    `입찰 승인과 제출 · ${status}`,
  ]);
  const pendingChange = pendingBuyerChange();
  byId('workflow-next').textContent = pendingChange
    ? `${pendingChange.owner} · ${pendingChange.deadline}까지 수정 납품표와 회신 증빙 확인 · ${pendingChange.content}`
    : reply ? `${reply.owner} · ${reply.deadline}까지 바이어 후속 확인`
      : submitted ? `${submitted.owner} · ${submitted.deadline}까지 바이어 회신 확인`
        : approval?.decision === 'approved' ? '영업 · 승인 조건을 확인하고 모의 제출하세요.'
          : approval?.decision === 'returned' ? `공급안 재계산 필요 · 승인 담당자 보완 사유 ${approval.reason}`
            : approval?.decision === 'declined' ? '입찰 참여 보류 결정이 기록됐습니다.'
              : blocked || 'CEO·이사회 · 검수된 공급안의 입찰 참여를 결정하세요.';
  renderList('workflow-history', history.length ? history : ['기록된 작업이 없습니다.']);
  const nextLink = byId('workflow-next-link');
  const buyerChanged = Boolean(pendingChange);
  const intakeReturned = Boolean(intake?.decision && intake.decision !== 'accepted');
  const supplyReturned = buyerChanged || approval?.decision === 'returned';
  const supplyBlocked = !review || issues.length || review.needsRecalculation || review.plans.some(({ revised, shipping }) =>
    revised.existingShortage > 0 || shipping?.shortage > 0) || !review.plans.some(({ revised }) => revised.proposal > 0);
  const departmentReturned = !supplyBlocked && !approval && roles.some((role) =>
    ['conditional', 'revise', 'rejected'].includes(review.reviews.get(role)?.decision));
  const outcome = intakeReturned || supplyReturned || departmentReturned ? 'return'
    : approval?.decision === 'declined' ? 'stop' : reply ? 'done' : 'next';
  nextLink.hidden = outcome === 'stop';
  nextLink.dataset.outcome = outcome;
  nextLink.href = buyerChanged ? '#buyer-change-edit' : supplyReturned ? '#capacity-entry'
    : !intake ? '#intake-request'
      : intakeReturned || (issues.length && !intake.conditions.deliverySchedule) ? '#review'
        : approval?.decision === 'approved' ? submitted ? '#buyer-reply-form' : '#proposal-document'
          : supplyBlocked ? '#capacity-entry' : blocked ? '#department-review' : '#proposal-workflow';
  nextLink.textContent = outcome === 'return' ? '보완할 단계 열기' : outcome === 'done' ? '회신 기록 열기' : '다음 작업 열기';
}

function saveApproval({ person, decision, reason, conditionalScope }) {
  const blocked = blockReason();
  if (blocked || approval) throw new Error(blocked || '이미 결정한 공급안입니다.');
  const conditions = intake.conditions;
  const openConditions = [
    ...(!dateKey(conditions.deadline) ? ['정확한 입찰 마감일'] : []),
    ...(!conditions.firstDelivery ? ['초도 납품일'] : []),
    ...(!conditions.splitDelivery ? ['분할 납품 조건'] : []),
  ];
  if (!person || !reason || !['approved', 'returned', 'declined'].includes(decision)) {
    throw new Error('승인 담당자와 결정 사유를 입력하세요.');
  }
  if (decision === 'approved' && openConditions.length && !conditionalScope) {
    throw new Error(`${openConditions.join(', ')} 미확인. 접수 조건을 보완하거나 바이어가 허용한 조건부 제안의 근거와 범위를 입력하세요.`);
  }
  const document = [
    `${review.customer || '입찰 검토 건'} 입찰 제안 · 공급안 버전 ${review.version}`,
    `승인 담당자 ${person}`,
    `승인 조건 ${reason}`,
    `입찰 마감 ${conditions.deadline || '확인 필요'} · 초도 납품일 ${conditions.firstDelivery || '확인 필요'} · 분할 조건 ${conditions.splitDelivery || '확인 필요'}`,
    `결제 ${conditions.payment || '확인 필요'} · 지연 페널티 ${conditions.penalty || '확인 필요'} · 산정 기준 ${conditions.penaltyBasis || '확인 필요'} · 품질 회수 비용 ${conditions.recall || '확인 필요'}`,
    ...(openConditions.length ? [`미확인 조건 ${openConditions.join(', ')} · 조건부 제안 근거와 범위 ${conditionalScope}`] : []),
    ...Object.values(intake.conditionEvidence ?? {}).map(({ value, source, owner }) => `확인 조건 ${value} · 근거 ${source} · 확인 ${owner}`),
    `확정 납품표 ${conditions.deliverySchedule} · 바이어 근거 ${conditions.deliveryEvidence}`,
    ...review.plans.filter(({ revised }) => revised.proposal > 0).map(({ week, deliveryDate, product, plant, line, revised, shipping }) =>
      `${product} · ${plant}/${line} · ${revised.proposal.toLocaleString('ko-KR')} EA · 생산 주차 ${week} · 납품 예정일 ${deliveryDate} · 물류 근거 ${shipping.source}`),
  ].join('\n');
  const nextApproval = { version: review.version, person, decision, reason, document };
  if (!saveState('proposal', { reviewKey, approval: nextApproval, submitted, reply, changeRequest })) {
    throw new Error('입찰 결정을 저장하지 못했습니다.');
  }
  approval = nextApproval;
  record(`공급안 ${review.version} · ${person} · ${{approved:'참여 승인', returned:'보완 요청', declined:'참여 보류'}[decision]} · ${reason}`);
  notice.textContent = '';
  render();
}

approvalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    saveApproval({ person: value('approver'), decision: value('approval-decision'),
      reason: value('approval-reason'), conditionalScope: value('conditional-scope') });
    const next = byId('workflow-next-link');
    if (!next.hidden) location.hash = next.hash;
  } catch (error) {
    notice.textContent = error.message;
  }
});

byId('proposal-submit').addEventListener('click', () => {
  if (blockReason() || approval?.decision !== 'approved' || submitted) return;
  const today = new Date();
  const submittedOn = experienceMode ? '2026-07-21'
    : [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  const deadline = new Date(`${submittedOn}T00:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() + 1);
  submitted = { version: approval.version, owner: '영업', submittedOn, deadline: deadline.toISOString().slice(0, 10) };
  byId('reply-owner').value = submitted.owner;
  byId('reply-date').value = submitted.deadline;
  record(`공급안 ${submitted.version} 모의 제출 ${submittedOn} · 영업 · ${submitted.deadline} 회신 확인`);
  persistProposal();
  render();
  location.hash = 'buyer-reply-form';
});

byId('experience-buyer-change').addEventListener('click', () => {
  if (!changeExperience || !submitted) return;
  byId('reply-type').value = 'change';
  const content = byId('reply-content');
  content.value = '체험용 변경 회신 SIM-BUYER-002. 수출 예약이 54,000 EA로 늘어, 2026-08-02 기초 1,500 EA·더마 500 EA로 조정하는 데 동의합니다. 물류 회신 SIM-LOG-002를 확인하세요.';
  const status = byId('reply-fill-status');
  status.textContent = '회신 유형과 내용을 채웠습니다. 확인한 뒤 바이어 회신 기록을 누르세요.';
  status.hidden = false;
  content.focus();
});

replyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!submitted) return;
  const owner = value('reply-owner');
  const deadline = value('reply-date');
  const type = value('reply-type');
  const content = value('reply-content');
  if (!owner || !deadline || !content || !['received', 'change'].includes(type)) {
    byId('buyer-reply-error').textContent = '회신 담당자, 기한, 유형과 내용을 입력하세요.';
    return;
  }
  byId('buyer-reply-error').textContent = '';
  reply = { owner, deadline, type, content };
  byId('reply-fill-status').hidden = true;
  record(`공급안 ${submitted.version} · 바이어 ${type === 'change' ? '조건 변경 요청' : '접수 확인'} · ${content} · ${owner} · ${deadline}`);
  notice.textContent = '';
  if (type === 'change') {
    changeRequest = { ...reply, id: crypto.randomUUID(), source: intake.source };
    reopenReview();
    window.dispatchEvent(new Event('corevia:buyer-change'));
    location.hash = 'buyer-change-edit';
  }
  else {
    persistProposal();
    render();
  }
});

render();
