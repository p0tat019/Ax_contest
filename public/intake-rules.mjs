export const fields = [
  ['customer', '요청 고객', '영업', '입찰 요청 고객을 확인하세요.'],
  ['products', '품목 및 요청 물량', '영업', '품목별 수량과 물량의 적용 기간을 확인하세요.'],
  ['deadline', '입찰 마감', '영업', '제안서 제출 기한을 확인하세요.'],
  ['firstDelivery', '초도 납품일', '영업', '바이어에게 최초 인도일을 확인하세요.'],
  ['deliverySchedule', '확정 납품표', '영업', '바이어가 확인한 날짜별 품목과 수량을 기록하세요. 연 예상수량과 구분하세요.'],
  ['deliveryEvidence', '납품표 확인 근거', '영업', '바이어 회신 번호·날짜와 확정 또는 변경 내용을 기록하세요.'],
  ['splitDelivery', '분할 납품 조건', '영업', '분할 허용 여부와 기간별 요구 물량을 확인하세요.'],
  ['payment', '결제 통화 및 조건', '재무·전략', '결제 통화와 지급 시점을 확인하세요.'],
  ['penalty', '납기 지연 페널티', '영업', '지연 페널티 조건을 확인하세요.'],
  ['penaltyBasis', '페널티 산정 기준과 한도', '영업', '페널티 적용 금액과 최대 한도를 확인하세요.'],
  ['recall', '품질 회수 비용 부담', '영업', '품질 회수 비용의 부담 주체를 확인하세요.'],
  ['production', '생산지 제약', '생산관리', '허용 생산지와 전환 시 필요한 바이어 확인을 검토하세요.'],
  ['weeklyCapacity', '주간 실효능력', '생산관리', '라인별 주간 가용량과 셋업·자재 제약을 확인하세요.'],
  ['existing', '기존 납품 약속 확인', '영업', '기존 고객의 확정 납기와 잔여 수량을 확인하세요.'],
];

export const example = `요청 고객: C-201
품목 및 요청 물량: 기초 PL-01 연 6,000,000 EA · 더마 PL-02 연 1,500,000 EA
입찰 마감: RFP 기준 3주
결제 통화 및 조건: USD
납기 지연 페널티: 월 3%
품질 회수 비용 부담: 공급자 부담
생산지 제약: 더마는 F1 전용 라인 기준`;

export function extractConditions(source) {
  const labels = new Map(fields.map(([key, label]) => [label, key]));
  const conditions = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s*)?([^:：]+)[:：]\s*(.+)$/);
    if (!match) continue;
    const key = labels.get(match[1].trim());
    const value = match[2].trim();
    if (key && value && !/^(미확인|미정|확인 필요|미제공|없음 확인 필요|[-–—])$/.test(value)) {
      conditions[key] = value;
    }
  }
  conditions.customer ??= source.match(/\bC-\d{3}\b(?=\s*(?:신규\s*)?입찰)/i)?.[0];
  conditions.deadline ??= source.match(/마감\s*(?:까지\s*)?(\d+\s*주)/)?.[1];
  conditions.payment ??= source.match(/결제\s*통화\s*[:：*\s]*\b(USD|KRW|EUR|JPY)\b/i)?.[1];
  conditions.penalty ??= source.match(/납기\s*지연\s*페널티\s*[:：*\s]*(월\s*\d+(?:\.\d+)?\s*%)/)?.[1];
  if (!conditions.products) {
    const products = [...source.matchAll(/\|[^|\n]*\b(PL-\d{2})\s*\|\s*([\d,]+)\s*\|/g)];
    if (products.length && /연\s*예상수량/.test(source)) {
      conditions.products = products.map(([, code, quantity]) => `${code} 연 ${quantity} EA`).join(' · ');
    }
  }
  return conditions;
}

export function pendingTasks(conditions) {
  const tasks = fields.filter(([key]) => !conditions[key]).map(([, label, owner, detail]) => ({ label, owner, detail }));
  if (/^(USD|KRW|EUR|JPY|달러|원화)$/i.test(conditions.payment ?? '')) {
    tasks.push({ label: '지급 시점', owner: '재무·전략', detail: '통화가 확인됐습니다. 지급 시점과 대금 회수 조건을 확인하세요.' });
  }
  if (/\d+\s*주/.test(conditions.deadline ?? '') && !/\d{4}[-.년]/.test(conditions.deadline)) {
    tasks.push({ label: '정확한 입찰 마감일', owner: '영업', detail: '상대 기한의 기준일과 실제 제출 마감일을 확인하세요.' });
  }
  return tasks;
}
