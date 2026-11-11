import { dateKey } from './proposal-checks.mjs';

function allocate(capacity, commitments, requested) {
  return {
    proposal: Math.min(requested, Math.max(0, capacity - commitments)),
    existingShortage: Math.max(0, commitments - capacity),
  };
}

export function deliveryWeek(date) {
  const key = dateKey(date);
  if (!key) return '';
  const day = new Date(`${key}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

export function shippingRecords(text) {
  const records = new Map();
  for (const entry of text.split('\n').filter((line) => line.trim())) {
    const [week, limit, reserved, ...notes] = entry.split('|').map((part) => part.trim());
    const capacity = Number(limit);
    const booked = Number(reserved);
    const source = notes.join(' | ');
    if (!week || deliveryWeek(week) !== week || !limit || !reserved || !source || records.has(week)
      || ![capacity, booked].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error('물류 근거를 월요일 | 처리 한도 | 예약 물량 | 회신 근거 형식으로 입력하세요. 한 주에 한 줄씩 입력합니다.');
    }
    records.set(week, { capacity, booked, source });
  }
  return records;
}

export function verifyShippingEvidence(deliveryDates, current, original) {
  for (const week of new Set(deliveryDates.map(deliveryWeek))) {
    const baseline = original.get(week);
    if (!baseline) continue;
    const latest = current.get(week);
    if (!latest) throw new Error(`${week} · 연결된 물류 근거를 확인하세요.`);
    if ((baseline.capacity !== latest.capacity || baseline.booked !== latest.booked) && baseline.source === latest.source) {
      throw new Error(`${week} · 처리 한도 또는 예약을 바꾸려면 새 물류 회신 근거를 입력하세요.`);
    }
  }
}

export function compareCapacity(rows, shipping = new Map(), previousShipping = shipping) {
  const seen = new Set();
  const plans = rows.map((row) => {
    const { week, product, plant, line, capacity, commitments, requested, additional, reduction, source } = row;
    if (!week || !product || !plant || !line || !source) throw new Error('주 시작일, 제품과 라인, 회신 근거를 입력하세요.');
    const weekStart = new Date(`${week}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || weekStart.getUTCDay() !== 1
      || weekStart.toISOString().slice(0, 10) !== week) {
      throw new Error('주 시작일은 월요일로 입력하세요.');
    }
    if (![capacity, commitments, requested, additional, reduction].every((value) => Number.isSafeInteger(value) && value >= 0)
      || !Number.isSafeInteger(commitments + additional) || reduction > capacity) {
      throw new Error('수량은 0 이상의 정수로 입력하고, 가용량 감소는 실효능력 이내로 입력하세요.');
    }
    const lineKey = `${week}/${plant}/${line}`;
    const productKey = `${week}/${product}`;
    if (seen.has(lineKey) || seen.has(productKey)) {
      throw new Error('같은 주의 라인 또는 품목은 한 행에서 집계하세요.');
    }
    seen.add(lineKey);
    seen.add(productKey);
    const baseline = allocate(capacity, commitments, requested);
    const revised = allocate(capacity - reduction, commitments + additional, requested);
    return { ...row, baseline, revised, unmetRequest: requested - revised.proposal };
  });
  const ordered = [...plans].sort((a, b) =>
    (a.deliveryDate ?? '').localeCompare(b.deliveryDate ?? '') || a.product.localeCompare(b.product)
  );
  const remaining = { baseline: new Map(), revised: new Map() };
  for (const plan of ordered) {
    const week = deliveryWeek(plan.deliveryDate);
    const record = shipping.get(week);
    if (!record) continue;
    plan.shipping = { week, ...record, shortage: Math.max(0, record.booked - record.capacity) };
    for (const [phase, evidence] of [['baseline', previousShipping.get(week) ?? record], ['revised', record]]) {
      const ledger = remaining[phase];
      const available = ledger.get(week) ?? Math.max(0, evidence.capacity - evidence.booked);
      const allocated = Math.min(plan[phase].proposal, available);
      ledger.set(week, available - allocated);
      if (phase === 'revised') plan.shipping.restricted = plan[phase].proposal - allocated;
      plan[phase].proposal = allocated;
    }
    plan.unmetRequest = plan.requested - plan.revised.proposal;
  }
  return plans;
}
