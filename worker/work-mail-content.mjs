const instructions = {
  'buyer/sales': ['바이어 회신으로 기존 납품 조건이 바뀌었습니다.', '수정 납품표를 수락하거나 추가 확인을 요청하세요.', ['품목별 수량과 납품일', '바이어가 변경에 동의한 회신 증빙']],
  'shipping/logistics': ['수정 납품표에 적용할 주차별 공동 출고 여력을 확인합니다.', '출고 한도와 예약을 확인하거나 확인 불가 사유를 기록하세요.', ['해당 주의 공동 출고 한도와 기존 예약량', '물류 회신 또는 예약 기록']],
  'department/sales': ['현재 공급안의 납품 조건을 영업에서 검수합니다.', '수락, 조건부 수락, 보완 요청, 반려 중에서 결정하세요.', ['확정 납품표와 바이어 증빙', '기존 고객 약속과 미충족 요청']],
  'department/production': ['현재 공급안을 생산하고 출고할 수 있는지 검수합니다.', '수락, 조건부 수락, 보완 요청, 반려 중에서 결정하세요.', ['주차별 생산 여력과 기존 납품 부족', '자재·품질 및 출고 제약의 확인 근거']],
  'department/finance': ['현재 공급안의 원가와 수금 조건을 검수합니다.', '수락, 조건부 수락, 보완 요청, 반려 중에서 결정하세요.', ['증분원가 근거', '지급·수금 조건과 검토 근거']],
  'approval/approver': ['부서 검수를 마친 공급안의 입찰 참여를 결정합니다.', '참여 승인, 보완 요청, 참여 보류 중 하나를 고르고 사유를 남기세요.', ['제안 수량과 납품일, 기존 납품 부족 여부', '부서 검수 결과와 재무·계약 위험', '미확인 조건이 있다면 조건부 제안의 허용 근거']],
  'submission/sales': ['최종 승인된 제안서를 확인할 차례입니다.', '승인 버전과 제안 조건을 대조한 후 모의 제출을 기록하세요.', ['승인된 제안서와 납품표', '승인 조건과 입찰 마감일']],
  'reply/sales': ['모의 제출 후 바이어 회신을 기록할 차례입니다.', '접수 확인 또는 조건 변경을 선택하고 회신을 기록하세요.', ['바이어 회신 원문 또는 증빙', '확인 담당자와 다음 확인 기한']],
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function workMailContent(route, title, role, link) {
  const [description, decision, evidence] = instructions[route];
  const heading = `[Corevia] ${title} 요청`;
  const access = '작업을 배정한 브라우저에서 링크를 열어 주세요. 작업이 보이지 않으면 배정자에게 문의하세요.';
  const text = [heading, `담당 역할 · ${role}`, '', description, '', '할 일', decision, '', '확인할 정보',
    ...evidence.map((item) => `- ${item}`), '', `Corevia에서 작업 열기 · ${link}`, '', access].join('\n');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#edf4f1;color:#17312a;font:15px/1.65 Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf4f1"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #d4e4dd;border-radius:12px"><tr><td style="padding:26px">
<p style="margin:0 0 6px;color:#096147;font-weight:bold">Corevia 약속계획 · ${escapeHtml(role)}</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.35">${escapeHtml(title)} 요청</h1>
<p style="margin:0 0 20px">${escapeHtml(description)}</p>
<h2 style="font-size:17px;margin:0 0 4px">할 일</h2><p style="margin:0 0 16px">${escapeHtml(decision)}</p>
<h2 style="font-size:17px;margin:0 0 4px">확인할 정보</h2>
<ul style="padding-left:22px;margin:0 0 24px">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
<a href="${escapeHtml(link)}" style="display:inline-block;background:#086349;color:white;padding:11px 18px;border-radius:7px;font-weight:bold;text-decoration:none">Corevia에서 작업 열기</a>
<p style="margin:20px 0 0;color:#425a52;font-size:13px">${escapeHtml(access)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: heading, text, html };
}
