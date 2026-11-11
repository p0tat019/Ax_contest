import { dateKey, proposalIssues } from './proposal-checks.mjs';

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

export function setWorkflowIntake(recordedIntake) {
  intake = recordedIntake;
  if (!history.some((entry) => entry.includes(` · 접수 검수 ${intake.version} ·`))) {
    changeRequest = null;
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
  if (!review) return '모듈 2에서 공급안을 계산하세요.';
  if (review.needsRecalculation) return '바이어 조건 변경 · 모듈 2에서 수정안을 다시 계산하세요.';
  if (review.plans.some(({ revised }) => revised.existingShortage > 0)) return '기존 고객 납품 부족을 해소하고 다시 계산하세요.';
  if (review.plans.some(({ shipping }) => shipping?.shortage > 0)) return '기존 예약이 출고 한도를 초과합니다. 물류 복구안을 확인하세요.';
  if (!review.plans.some(({ revised }) => revised.proposal > 0)) return '제안할 물량이 있는 공급안을 계산하세요.';
  if (proposalIssues(intake.conditions, review.plans).length) return '확정 납품표와 공급안의 날짜·수량·출고 근거를 확인하세요.';
  const pending = roles.filter((role) => review.reviews.get(role)?.decision !== 'accepted');
  return pending.length ? `${pending.join(', ')} 검수 수락이 필요합니다.` : '';
}

function render() {
  const blocked = blockReason();
  const issues = intake && review ? proposalIssues(intake.conditions, review.plans) : [];
  renderList('proposal-issues', issues);
  byId('proposal-issues').hidden = !issues.length;
  approvalForm.hidden = Boolean(blocked || approval);
  byId('proposal-document').hidden = Boolean(blocked || approval?.decision !== 'approved');
  byId('proposal-submit').disabled = Boolean(submitted);
  replyForm.hidden = !submitted || reply?.type === 'change';
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
  renderList('workflow-steps', [
    `입찰 접수 · ${intake ? `검수 버전 ${intake.version} · ${{accepted:'수락', 'needs-information':'보완 요청', rejected:'반려'}[intake.decision] ?? '수락'}` : '대기'}`,
    `공급 가능량 · ${review ? `공급안 버전 ${review.version}` : '계산 대기'}`,
    `부서 검수 · ${review ? [...review.reviews.values()].filter((entry) => entry.decision === 'accepted').length : 0}/3 수락`,
    `입찰 승인과 제출 · ${status}`,
  ]);
  byId('workflow-next').textContent = changeRequest && (!review || review.needsRecalculation)
    ? `${changeRequest.owner} · ${changeRequest.deadline}까지 변경 조건 확인 · ${changeRequest.content}`
    : reply ? `${reply.owner} · ${reply.deadline}까지 바이어 후속 확인`
      : submitted ? `${submitted.owner} · ${submitted.deadline}까지 바이어 회신 확인`
        : approval?.decision === 'approved' ? '영업 · 승인 조건을 확인하고 모의 제출하세요.'
          : approval?.decision === 'returned' ? '담당 부서 · 보완 사유를 반영해 공급안을 다시 계산하세요.'
            : approval?.decision === 'declined' ? '입찰 참여 보류 결정이 기록됐습니다.'
              : blocked || 'CEO·이사회 · 검수된 공급안의 입찰 참여를 결정하세요.';
  renderList('workflow-history', history.length ? history : ['기록된 작업이 없습니다.']);
  byId('workflow-next-link').href = !intake || (intake.decision && intake.decision !== 'accepted') ? '#intake-request'
    : !review || issues.length || review.needsRecalculation || review.plans.some(({ revised }) => revised.existingShortage > 0) ? '#capacity'
      : blocked ? '#department-review' : '#proposal-workflow';
}

approvalForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (blockReason() || approval) return;
  const person = value('approver');
  const decision = value('approval-decision');
  const reason = value('approval-reason');
  const conditionalScope = value('conditional-scope');
  const conditions = intake.conditions;
  const openConditions = [
    ...(!dateKey(conditions.deadline) ? ['정확한 입찰 마감일'] : []),
    ...(!conditions.firstDelivery ? ['초도 납품일'] : []),
    ...(!conditions.splitDelivery ? ['분할 납품 조건'] : []),
  ];
  if (!person || !reason || !['approved', 'returned', 'declined'].includes(decision)) {
    notice.textContent = '승인 담당자와 결정 사유를 입력하세요.';
    return;
  }
  if (decision === 'approved' && openConditions.length && !conditionalScope) {
    notice.textContent = `${openConditions.join(', ')} 미확인. 접수 조건을 보완하거나 바이어가 허용한 조건부 제안의 근거와 범위를 입력하세요.`;
    return;
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
  approval = { version: review.version, person, decision, reason, document };
  record(`공급안 ${review.version} · ${person} · ${{approved:'참여 승인', returned:'보완 요청', declined:'참여 보류'}[decision]} · ${reason}`);
  persistProposal();
  notice.textContent = '';
  render();
});

byId('proposal-submit').addEventListener('click', () => {
  if (blockReason() || approval?.decision !== 'approved' || submitted) return;
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 1);
  const localDate = [deadline.getFullYear(), String(deadline.getMonth() + 1).padStart(2, '0'), String(deadline.getDate()).padStart(2, '0')].join('-');
  submitted = { version: approval.version, owner: '영업', deadline: localDate };
  byId('reply-owner').value = submitted.owner;
  byId('reply-date').value = submitted.deadline;
  record(`공급안 ${submitted.version} 모의 제출 · 영업 · 다음 날 회신 확인`);
  persistProposal();
  render();
});

replyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!submitted) return;
  const owner = value('reply-owner');
  const deadline = value('reply-date');
  const type = value('reply-type');
  const content = value('reply-content');
  if (!owner || !deadline || !content || !['received', 'change'].includes(type)) {
    notice.textContent = '회신 담당자, 기한, 유형과 내용을 입력하세요.';
    return;
  }
  reply = { owner, deadline, type, content };
  record(`공급안 ${submitted.version} · 바이어 ${type === 'change' ? '조건 변경 요청' : '접수 확인'} · ${content} · ${owner} · ${deadline}`);
  notice.textContent = '';
  if (type === 'change') {
    changeRequest = reply;
    reopenReview();
  }
  else {
    persistProposal();
    render();
  }
});

render();
import { loadState, saveState } from './workflow-storage.mjs';
