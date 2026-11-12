export const workRoles = Object.freeze({
  sales: '영업', logistics: '물류', production: '생산관리', finance: '재무·전략', approver: 'CEO·이사회',
});

export const workMailRoutes = Object.freeze({
  'buyer/sales': '변경 납품표 확인',
  'shipping/logistics': '공동 출고 확인',
  'department/sales': '영업 검수',
  'department/production': '생산관리 검수',
  'department/finance': '재무 검수',
  'approval/approver': '입찰 참여 결정',
  'submission/sales': '승인 제안 확인',
  'reply/sales': '바이어 회신 기록',
});

export function validWorkEmail(value) {
  return typeof value === 'string' && value.length <= 254
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value);
}
