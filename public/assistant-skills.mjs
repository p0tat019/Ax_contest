export const modules = {
  intake: { title: '입찰 접수', anchor: 'intake-request', context: ['review-summary', 'draft-tasks'] },
  capacity: { title: '생산능력 계산', anchor: 'capacity', context: ['capacity-intake', 'capacity-summary'] },
  review: { title: '부서 검수', anchor: 'department-review', context: ['department-status', 'department-next'] },
  proposal: { title: '승인·모의 제출', anchor: 'proposal-workflow', context: ['proposal-status'] },
  dashboard: { title: '진행 대시보드', anchor: 'dashboard-heading', context: ['workflow-steps', 'workflow-next'] },
};

export const drafts = {
  intake: { request: '입찰 요청 원문 초안' },
  capacity: { capacity: '실효능력', commitments: '기존 약속', requested: '신규 요청', additional: '추가 확정 주문', reduction: '가용량 감소' },
  review: { 'department-feedback': '부서 회신 초안' },
  proposal: { 'approval-reason': '입찰 결정 사유 초안', 'buyer-scope': '바이어 근거 초안', 'conditional-scope': '조건부 제안 범위 초안', 'reply-content': '바이어 회신 기록 초안' },
};

export const requestOwners = ['영업', '생산관리', '조달·품질', '재무·전략'];
