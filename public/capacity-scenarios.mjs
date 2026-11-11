const week = '2026-09-14';
const basic = { product: 'PL-01', plant: 'F1', line: 'L-01', capacity: 330000, commitments: 290000, requested: 40000 };
const derma = { product: 'PL-02', plant: 'F1', line: 'L-02', capacity: 75000, commitments: 60000, requested: 15000 };
const row = (product, changes = {}) => ({
  week, ...product, additional: 0, reduction: 0, source: '검증용 모의 영업·생산 회신', ...changes,
});

export const scenarios = [
  {
    id: 'normal', label: '정상 공급 · 두 품목 요청 충족',
    question: '기존 약속을 보호하면서 신규 요청을 모두 충족할 수 있는가?',
    rows: [row(basic), row(derma)],
    expected: { proposal: 55000, existingShortage: 0, unmet: 0 },
  },
  {
    id: 'order-recovery', label: '기존 주문 회복 · 일부 물량만 제안',
    question: 'C-101의 추가 확정 주문을 먼저 배정하면 C-201 제안은 얼마나 줄어드는가?',
    rows: [row(basic), row(derma, { additional: 9000 })],
    expected: { proposal: 46000, existingShortage: 0, unmet: 9000 },
  },
  {
    id: 'quality-hold', label: '품질 보류 · 기존 고객 납품 부족',
    question: '가용량까지 감소하면 신규 제안 축소만으로 기존 약속을 보호할 수 있는가?',
    rows: [row(basic), row(derma, { additional: 9000, reduction: 7000 })],
    expected: { proposal: 40000, existingShortage: 1000, unmet: 15000 },
  },
  {
    id: 'preexisting-shortage', label: '이미 부족한 기준안 · 신규 입찰 전 복구',
    question: '신규 입찰 이전에 존재한 부족을 별도로 볼 수 있는가?',
    rows: [row(derma, { commitments: 76000 })],
    expected: { proposal: 0, existingShortage: 1000, baselineShortage: 1000, unmet: 15000 },
  },
  {
    id: 'no-room', label: '잔여 능력 0 · 기존 약속만 이행',
    question: '기존 납품 부족 없이 신규 공급만 불가능한 경우를 구분하는가?',
    rows: [row(derma, { commitments: 75000 })],
    expected: { proposal: 0, existingShortage: 0, unmet: 15000 },
  },
  {
    id: 'weekly-mismatch', label: '주차 충돌 · 다음 주에는 여유',
    question: '다음 주 여유가 있더라도 이번 주 미충족을 숨기지 않는가?',
    rows: [row(derma, { commitments: 75000 }), row(derma, { week: '2026-09-21', commitments: 45000, requested: 0 })],
    expected: { proposal: 0, existingShortage: 0, unmet: 15000 },
  },
  {
    id: 'missing-evidence', label: '입력 오류 · 회신 근거 누락',
    question: '출처가 없는 생산 숫자로 공급안을 만들 수 있는가?',
    rows: [row(derma, { source: '' })],
    expectedError: '회신 근거',
  },
  {
    id: 'duplicate', label: '입력 오류 · 같은 라인과 주차 중복',
    question: '동일 라인의 가용량과 요청량이 이중 집계되는가?',
    rows: [row(derma), row(derma)],
    expectedError: '한 행에서 집계',
  },
  {
    id: 'invalid-reduction', label: '입력 오류 · 실효능력보다 큰 감소량',
    question: '잘못된 생산 감소량을 계산 전에 차단하는가?',
    rows: [row(derma, { reduction: 75001 })],
    expectedError: '실효능력 이내',
  },
];
