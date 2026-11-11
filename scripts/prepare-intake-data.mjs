import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../01_참가자_배포용/04_원본데이터/01_corevia/', import.meta.url);
const orderSource = 'sales/sales_orders_cv.csv';
const shipmentSource = 'sales/sales_shipments_cv.csv';
const capacitySource = 'production/strat_capacity_cv.csv';
const asOf = '2026-07-01';

async function readRows(path) {
  const [header, ...lines] = (await readFile(new URL(path, root), 'utf8'))
    .replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const keys = header.split('|');
  return lines.map((line) => {
    const values = line.split('|');
    if (values.length !== keys.length) throw new Error(`Unexpected column count in ${path}`);
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  });
}

const [orders, shipments, capacity] = await Promise.all([
  readRows(orderSource), readRows(shipmentSource), readRows(capacitySource),
]);
const shippedOrders = new Set(shipments.filter((row) => row.ship_date <= asOf).map((row) => row.order_id));
const candidates = orders.filter((row) =>
  row.customer_id === 'C-101' && row.order_date <= asOf && !shippedOrders.has(row.order_id));
const monthly = new Map();
for (const [records, date, quantity, series] of [
  [orders, 'order_date', 'order_qty', 'orders'],
  [shipments, 'ship_date', 'shipped_qty', 'shipments'],
]) {
  for (const row of records) {
    if (row.customer_id !== 'C-101' || row[date] >= asOf) continue;
    const month = row[date].slice(0, 7);
    const totals = monthly.get(month) ?? { month, orders: 0, shipments: 0 };
    totals[series] += Number(row[quantity]);
    monthly.set(month, totals);
  }
}

const snapshot = {
  asOf,
  existingCustomer: {
    customer: 'C-101',
    unlinkedOrders: candidates.length,
    orderQuantity: candidates.reduce((sum, row) => sum + Number(row.order_qty), 0),
    sources: [orderSource, shipmentSource],
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12),
  },
  lines: capacity.map((row) => ({
    product: row.product_id,
    plant: row.plant_id,
    line: row.line_id,
    utilization: Number(row.utilization_pct),
    date: row.snapshot_date,
    source: capacitySource,
  })),
};
await writeFile(new URL('../public/intake-data.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
