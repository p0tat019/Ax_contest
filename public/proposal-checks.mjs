export function dateKey(value) {
  const match = value?.trim().match(/^(\d{4})[-.년]\s*(\d{1,2})[-.월]\s*(\d{1,2})\s*일?\.?$/);
  if (!match) return '';
  const [, year, month, day] = match;
  const key = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : '';
}

export function deliverySchedule(value) {
  if (!value?.trim()) return [];
  const seen = new Set();
  return value.split(/[;\n]/).filter((entry) => entry.trim()).map((entry) => {
    const match = entry.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(PL-\d{2})\s+([\d,]+)(?:\s+EA)?$/i);
    const date = dateKey(match?.[1]);
    const product = match?.[2].toUpperCase();
    const quantity = Number(match?.[3].replaceAll(',', ''));
    const key = `${date}/${product}`;
    if (!date || !Number.isSafeInteger(quantity) || quantity <= 0 || seen.has(key)) {
      throw new Error('확정 납품표를 YYYY-MM-DD PL-01 30000 형식으로 입력하세요. 같은 날짜·품목은 합산하세요.');
    }
    seen.add(key);
    return { date, product, quantity };
  });
}

export function proposalIssues(conditions, plans) {
  const requested = new Set(conditions.products?.toUpperCase().match(/\bPL-\d{2}\b/g));
  const issues = [];
  if (!requested.size) issues.push('RFP의 요청 품목 코드를 입찰 접수에서 확인하세요.');
  let schedule = [];
  try { schedule = deliverySchedule(conditions.deliverySchedule); }
  catch (error) { issues.push(error.message); }
  if (!schedule.length) issues.push('바이어가 확인한 날짜·품목별 납품 수량을 영업 검수에 기록하세요.');
  if (!conditions.deliveryEvidence?.trim()) issues.push('확정 납품표 또는 변경에 대한 바이어 회신 근거를 기록하세요.');
  const scheduleProducts = new Set(schedule.map(({ product }) => product));
  for (const product of requested) {
    if (!scheduleProducts.has(product)) issues.push(`확정 납품표에 RFP 품목 ${product}가 빠졌습니다.`);
  }
  const deliveryDates = new Set();
  const firstDelivery = dateKey(conditions.firstDelivery);
  const deadline = dateKey(conditions.deadline);
  if (!firstDelivery) issues.push('확정 초도 납품일을 정확한 날짜로 입력하세요.');
  if (deadline && firstDelivery && firstDelivery < deadline) issues.push('확정 초도 납품일이 입찰 마감일보다 빠릅니다. 바이어 회신을 확인하세요.');
  if (firstDelivery && schedule.length && schedule.map(({ date }) => date).sort()[0] !== firstDelivery) {
    issues.push('확정 납품표의 첫 날짜가 확인된 초도 납품일과 다릅니다.');
  }
  const proposed = new Map();
  for (const row of plans.filter(({ revised }) => revised.proposal > 0)) {
    const delivery = dateKey(row.deliveryDate);
    const label = `${row.week} 주차 ${row.product}`;
    if (!delivery) issues.push(`${label} · 납품 예정일을 입력하세요.`);
    else {
      deliveryDates.add(delivery);
      if (delivery < row.week) issues.push(`${label} · 납품 예정일이 생산 주차 시작일보다 빠릅니다.`);
      if (firstDelivery && delivery < firstDelivery) issues.push(`${label} · 납품 예정일 ${delivery}가 초도 납품일 ${firstDelivery}보다 빠릅니다.`);
      const key = `${delivery}/${row.product}`;
      proposed.set(key, (proposed.get(key) ?? 0) + row.revised.proposal);
    }
    if (!row.shipping) issues.push(`${label} · 납품 주간의 출고 한도·예약 근거가 필요합니다.`);
  }
  for (const { date, product, quantity } of schedule) {
    const key = `${date}/${product}`;
    const actual = proposed.get(key) ?? 0;
    if (!requested.has(product)) issues.push(`확정 납품표의 ${product}를 RFP 요청 품목과 대조하세요.`);
    if (actual !== quantity) issues.push(`${date} ${product} · 확정 ${quantity.toLocaleString()} EA / 제안 ${actual.toLocaleString()} EA. 변경 제안은 바이어 회신으로 납품표를 갱신하세요.`);
    proposed.delete(key);
  }
  for (const [key] of proposed) issues.push(`${key} · 바이어가 확인한 납품표에 없는 제안입니다.`);
  if (deliveryDates.size > 1) {
    const split = conditions.splitDelivery ?? '';
    if (!/허용|가능|동의/.test(split) || /불가|금지|미허용|미동의|허용하지\s*않|동의하지\s*않|일괄/.test(split)) {
      issues.push('복수 납품일로 제안하려면 바이어의 분할 납품 허용 조건을 확인하세요.');
    }
  }
  return issues;
}
