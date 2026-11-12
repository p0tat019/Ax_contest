export const allocationOrder = (a, b) =>
  (a.deliveryDate ?? '').localeCompare(b.deliveryDate ?? '') || a.product.localeCompare(b.product)
  || a.week.localeCompare(b.week) || a.plant.localeCompare(b.plant) || a.line.localeCompare(b.line);

export function protectCommitments(capacity, commitments) {
  const remaining = capacity - commitments;
  return { available: Math.max(0, remaining), existingShortage: Math.max(0, -remaining) };
}

export function allocateProduction(capacity, commitments, requested) {
  const { available, existingShortage } = protectCommitments(capacity, commitments);
  return { proposal: Math.min(requested, available), existingShortage };
}

export function allocateShipping(production, reservations, ledger, week) {
  const available = ledger.get(week) ?? Math.max(0, reservations.capacity - reservations.booked);
  const allocated = Math.min(production, available);
  ledger.set(week, available - allocated);
  return allocated;
}
