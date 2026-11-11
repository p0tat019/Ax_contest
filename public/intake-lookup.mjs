// Stable lookup input and result shapes can be shared with a server or MCP tool.
export async function lookupEvidence({ customer, products }) {
  const response = await fetch(new URL('./intake-data.json', import.meta.url));
  if (!response.ok) throw new Error('Evidence data unavailable');
  const snapshot = await response.json();
  const productCodes = new Set((products ?? '').toUpperCase().match(/\bPL-\d{2}\b/g));
  return {
    asOf: snapshot.asOf,
    existingCustomer: customer?.toUpperCase() === 'C-201' ? snapshot.existingCustomer : null,
    lines: snapshot.lines.filter((line) => productCodes.has(line.product)),
  };
}
