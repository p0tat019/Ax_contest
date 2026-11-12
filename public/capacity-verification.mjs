export function verifyAllocation(plans) {
  const failures = [];
  const byWeek = new Map();
  let missingShipping = 0;
  for (const plan of plans) {
    const effective = plan.capacity - plan.reduction;
    const obligations = plan.commitments + plan.additional;
    const { proposal, existingShortage } = plan.revised;
    const production = Math.min(plan.requested, Math.max(0, effective - obligations));
    if (!Number.isSafeInteger(proposal) || proposal < 0 || proposal > production
      || existingShortage !== Math.max(0, obligations - effective)
      || plan.unmetRequest !== plan.requested - proposal) {
      failures.push(`${plan.week} ${plan.product} · 생산 또는 잔여 수량 불일치`);
    }
    if (!plan.shipping) {
      if (proposal > 0) missingShipping++;
      continue;
    }
    if (plan.shipping.restricted !== production - proposal) {
      failures.push(`${plan.shipping.week} ${plan.product} · 출고 차감 불일치`);
    }
    const { week, capacity, booked } = plan.shipping;
    const limit = Math.max(0, capacity - booked);
    const total = (byWeek.get(week)?.total ?? 0) + proposal;
    if (total > limit) failures.push(`${week} · 공동 출고 한도 초과`);
    byWeek.set(week, { week, total, limit });
  }
  return { failures, missingShipping, shippingWeeks: [...byWeek.values()] };
}

export function summarizeSupply(plans) {
  const totals = { requested: 0, production: 0, shippingLoss: 0, proposal: 0, existingShortage: 0, missingShipping: 0 };
  for (const plan of plans) {
    const { proposal, existingShortage } = plan.revised;
    const production = Math.min(plan.requested, Math.max(0, plan.capacity - plan.reduction - plan.commitments - plan.additional));
    totals.requested += plan.requested;
    totals.production += production;
    totals.shippingLoss += plan.shipping?.restricted ?? 0;
    totals.proposal += proposal;
    totals.existingShortage += existingShortage;
    if (!plan.shipping && proposal > 0) totals.missingShipping++;
  }
  return totals;
}
