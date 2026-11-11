import assert from 'node:assert/strict';
import { compareCapacity, shippingRecords, verifyShippingEvidence } from '../public/capacity-plan.mjs';
import { scenarios } from '../public/capacity-scenarios.mjs';
import { deliverySchedule, proposalIssues } from '../public/proposal-checks.mjs';

for (const scenario of scenarios) {
  if (scenario.expectedError) {
    assert.throws(() => compareCapacity(scenario.rows), { message: new RegExp(scenario.expectedError) }, scenario.id);
    console.log(`PASS ${scenario.id}: ${scenario.expectedError}`);
    continue;
  }
  const plans = compareCapacity(scenario.rows);
  const sum = (selector) => plans.reduce((total, plan) => total + selector(plan), 0);
  const actual = {
    proposal: sum((plan) => plan.revised.proposal),
    existingShortage: sum((plan) => plan.revised.existingShortage),
    unmet: sum((plan) => plan.unmetRequest),
  };
  if ('baselineShortage' in scenario.expected) actual.baselineShortage = sum((plan) => plan.baseline.existingShortage);
  assert.deepEqual(actual, scenario.expected, scenario.id);
  console.log(`PASS ${scenario.id}: ${JSON.stringify(actual)}`);
}

const date = '2026-08-02';
const week = '2026-07-27';
const inputs = ['PL-01', 'PL-02'].map((product, index) => ({
  week, product, plant: 'F1', line: `L-0${index + 1}`, deliveryDate: date,
  capacity: 100, commitments: 20, requested: 30, additional: 0, reduction: 0, source: '모의 생산 회신',
}));
const original = shippingRecords(`${week} | 100 | 40 | 모의 물류 회신`);
const booked = shippingRecords(`${week} | 100 | 60 | 모의 예약 변경`);
const conditions = {
  products: 'PL-01 연 600만 EA · PL-02 연 150만 EA',
  firstDelivery: date, deliverySchedule: `${date} PL-01 30; ${date} PL-02 30`,
  deliveryEvidence: '모의 바이어 회신', splitDelivery: '분할 불가',
};
assert.deepEqual(proposalIssues(conditions, compareCapacity(inputs, original)), []);
assert.match(proposalIssues(conditions, compareCapacity(inputs)).join(), /출고 한도/);
const changed = compareCapacity(inputs, booked, original);
assert.deepEqual(changed.map((row) => row.revised.proposal), [30, 10]);
assert.deepEqual(changed.map((row) => row.baseline.proposal), [30, 30]);
assert.match(proposalIssues(conditions, changed).join(), /확정 30 EA \/ 제안 10 EA/);
const later = '2026-08-09';
const split = shippingRecords(`${week} | 100 | 60 | 변경\n2026-08-03 | 100 | 60 | 추가 주간`);
const moved = compareCapacity([inputs[0], { ...inputs[1], deliveryDate: later, week: '2026-08-03' }], split);
assert.match(proposalIssues(conditions, moved).join(), /확정 30 EA \/ 제안 0 EA/);
const updated = { ...conditions, deliverySchedule: `${date} PL-01 30; ${later} PL-02 30` };
assert.match(proposalIssues(updated, moved).join(), /분할 납품 허용/);
assert.deepEqual(proposalIssues({ ...updated, splitDelivery: '분할 납품 허용' }, moved), []);
assert.match(proposalIssues({ ...conditions, deliveryEvidence: '' }, changed).join(), /바이어 회신 근거/);
assert.throws(() => deliverySchedule(`${date} PL-01 30; ${date} PL-01 30`), /같은 날짜/);
assert.throws(() => shippingRecords(`${week} | 100 | 40 | 확인\n${week} | 120 | 40 | 중복`), /한 주에 한 줄/);
assert.throws(() => verifyShippingEvidence([date], new Map(), original), /물류 근거/);
assert.throws(() => verifyShippingEvidence([date], shippingRecords(`${week} | 100 | 60 | 모의 물류 회신`), original), /새 물류 회신/);
assert.doesNotThrow(() => verifyShippingEvidence([date], booked, original));
console.log('PASS shared shipping capacity, exact delivery dates and quantities, buyer-approved split, missing evidence');
