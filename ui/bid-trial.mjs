import { compareCapacity, expansionAvailable, supplyChecks } from '../public/capacity-plan.mjs';
import { extractConditions } from '../public/intake-rules.mjs';
import { deliverySchedule, proposalIssues } from '../public/proposal-checks.mjs';
import { weeks } from './supply-overview-data.mjs';

const week = '2026-07-27';
const delivery = '2026-08-02';
export const defaults = { capacity1: 100, capacity2: 100, existing1: 30, existing2: 30,
  demand1: 30, demand2: 30, extra: 0, shipping: 80, booked: 10, expansion: 0, start: delivery };

export function runFollowupExample() {
  const exampleWeek = weeks[0];
  const shipping = exampleWeek.shipments.find(({ route }) => route === '수출 출고');
  const before = { ...shipping, source: '모의 물류 대시보드' };
  const after = { ...before, booked: 54000, source: 'SIM-LOG-002' };
  const previousShipping = new Map([[week, before]]);
  const revisedShipping = new Map([[week, after]]);
  const rows = exampleWeek.products.map(({ code, line, stock, hold, output, recurring, reserved }, index) => {
    const [plant, lineId] = line.split('/').map((part) => part.trim());
    return { week, deliveryDate: delivery, product: code, plant, line: lineId,
      capacity: stock - hold + output, commitments: recurring + reserved,
      requested: index === 0 ? 10000 : 6000, additional: 0, reduction: 0, source: '모의 납품표' };
  });
  const revisedRows = rows.map((row, index) => ({ ...row, requested: index === 0 ? 1500 : 500 }));
  const previous = compareCapacity(rows, previousShipping);
  const limited = compareCapacity(rows, revisedShipping);
  const revised = compareCapacity(revisedRows, revisedShipping);
  const capacityShortage = compareCapacity(rows.map((row) => row.product === 'PL-02'
    ? { ...row, reduction: row.capacity - row.commitments + 1 } : row), previousShipping);
  return { before, after, previous, limited, revised,
    logisticsChecks: supplyChecks(limited),
    productionChecks: supplyChecks(capacityShortage).filter(({ owner }) => owner !== '물류') };
}

export function prepareTrial(input) {
  const values = {};
  const filled = [];
  for (const [key, fallback] of Object.entries(defaults)) {
    const raw = input[key];
    if (raw === '' || raw === undefined) {
      values[key] = fallback;
      filled.push(key);
    } else if (key === 'start') {
      values[key] = raw;
    } else {
      if (!/^\d{1,3}$/.test(String(raw)) || Number(raw) > 500
        || (key.startsWith('demand') && Number(raw) < 1)) {
        return { errorKey: key };
      }
      values[key] = Number(raw);
    }
  }
  if (![delivery, '2026-08-03'].includes(values.start)) return { errorKey: 'start' };
  return { values, filled };
}

export function generateTrial(seed) {
  let state = seed >>> 0;
  const pick = (min, max) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return min + Math.floor((state / 4294967296) * (max - min + 1));
  };
  return {
    capacity1: pick(55, 140), capacity2: pick(45, 135), existing1: pick(20, 80), existing2: pick(20, 75),
    demand1: pick(15, 75), demand2: pick(15, 75), extra: pick(0, 35),
    shipping: pick(45, 165), booked: pick(5, 65), expansion: pick(0, 40),
    start: pick(0, 1) ? '2026-08-03' : delivery,
  };
}

// Independently enumerate feasible allocations and keep the highest priority combination.
// The trial caps input quantities so this check remains bounded in the browser.
function enumerate(rows, available) {
  const [a, b] = rows;
  let expected = [0, 0];
  for (let first = 0; first <= a.requested; first++) {
    if (first > 0 && first + a.commitments > a.capacity) break;
    for (let second = 0; second <= b.requested; second++) {
      if (second > 0 && second + b.commitments > b.capacity) break;
      if (first + second > available) break;
      expected = [first, second];
    }
  }
  return expected;
}

export function runTrial(input) {
  const values = Object.entries(input).filter(([key]) => key !== 'start').map(([, value]) => value);
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 500)
    || input.demand1 === 0 || input.demand2 === 0 || !['2026-08-02', '2026-08-03'].includes(input.start)) {
    throw new Error('수량은 0~500 EA 범위의 정수로 입력하세요. 신규 요청은 각 품목 1 EA 이상이어야 합니다.');
  }
  const source = `요청 고객: C-201\n품목 및 요청 물량: PL-01 ${input.demand1} EA · PL-02 ${input.demand2} EA\n입찰 마감: 2026-07-22\n초도 납품일: ${delivery}\n확정 납품표: ${delivery} PL-01 ${input.demand1}; ${delivery} PL-02 ${input.demand2}\n납품표 확인 근거: 생성된 모의 회신\n분할 납품 조건: 일괄 납품`;
  const conditions = extractConditions(source);
  const expansion = expansionAvailable(input.expansion, input.start, delivery);
  const rows = deliverySchedule(conditions.deliverySchedule).map(({ product, quantity, date }, index) => ({
    week, deliveryDate: date, product, plant: 'F1', line: `L-0${index + 1}`,
    capacity: index ? input.capacity2 + expansion : input.capacity1,
    commitments: index ? input.existing2 : input.existing1, requested: quantity,
    additional: index ? input.extra : 0, reduction: 0, source: '생성된 모의 생산·주문 입력',
  }));
  const shipping = new Map([[week, { capacity: input.shipping, booked: input.booked, source: '생성된 모의 물류 입력' }]]);
  const plans = compareCapacity(rows, shipping);
  const issues = proposalIssues(conditions, plans);
  const expectedExpansion = input.start === delivery ? input.expansion : 0;
  const expected = enumerate([
    { requested: input.demand1, commitments: input.existing1, capacity: input.capacity1 },
    { requested: input.demand2, commitments: input.existing2 + input.extra, capacity: input.capacity2 + expectedExpansion },
  ], Math.max(0, input.shipping - input.booked));
  const expectedShortage = [Math.max(0, input.existing1 - input.capacity1),
    Math.max(0, input.existing2 + input.extra - input.capacity2 - expectedExpansion)];
  const actual = plans.map((row) => row.revised.proposal);
  const checks = [
    ['독립 배정 대조', actual.every((quantity, index) => quantity === expected[index])],
    ['기존 고객 부족량 대조', plans.every((row, index) => row.revised.existingShortage === expectedShortage[index])],
    ['공동 출고 한도 준수', actual.reduce((sum, value) => sum + value, 0) <= Math.max(0, input.shipping - input.booked)],
    ['납품일 전 가동분만 반영', expansion === expectedExpansion],
  ];
  const shortage = plans.some((row) => row.revised.existingShortage > 0);
  const overloaded = input.booked > input.shipping;
  const action = checks.some(([, pass]) => !pass) ? '검증 불일치 · 결과를 사용하지 마세요.'
    : shortage ? '기존 납품 부족 · 신규 확약 보류, 기존 물량 복구안 확인'
      : overloaded ? '기존 출고 예약 초과 · 물류 계획 조정 필요'
        : issues.length ? '확정 납품표와 불일치 · 물량 또는 일정 재협의 필요'
          : '입력 조건 충족 · 담당자 검수로 진행 가능';
  const stages = [
    ['입찰 요청 접수', `${conditions.customer} · ${rows.length}개 품목 · 초도 ${conditions.firstDelivery}`],
    ['기존 납품·공급 여력 확인', `기존 약속 ${input.existing1 + input.existing2 + input.extra} EA · 출고 예약 ${input.booked}/${input.shipping} EA`],
    ['공급조건 계산·검증', `신규 배정 ${actual.reduce((sum, value) => sum + value, 0)} EA · 독립 대조 ${checks.filter(([, pass]) => pass).length}/${checks.length} 통과`],
    ['검토 결과', action],
  ];
  return { source, plans, issues, checks, expected, expansion, action, stages };
}

export const goldenTrials = [
  ['정상 공급', {}, [30, 30], [0, 0]],
  ['생산 병목', { capacity2: 42 }, [30, 12], [0, 0]],
  ['기존 고객 추가 주문', { capacity2: 55, extra: 30 }, [30, 0], [0, 5]],
  ['증설 지연', { capacity2: 40, expansion: 20, start: '2026-08-03' }, [30, 10], [0, 0]],
  ['공동 출고 경합', { shipping: 45 }, [30, 5], [0, 0]],
];

export function runGoldenTrials() {
  return goldenTrials.map(([label, patch, expected, shortage]) => {
    const { plans } = runTrial({ ...defaults, ...patch });
    return { label, expected, actual: plans.map((row) => row.revised.proposal),
      passed: plans.every((row, index) => row.revised.proposal === expected[index] && row.revised.existingShortage === shortage[index]) };
  });
}
