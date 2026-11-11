import { example } from '../public/intake-rules.mjs';

// Independent week-opening forecasts. Incoming production excludes units already in stock.
export const weeks = [
  {
    start: '2026-07-27',
    label: '7월 27일–8월 2일',
    products: [
      { code: 'PL-01', name: '기초', line: 'F1 / L-01', stock: 118000, hold: 8000, output: 84000, recurring: 98000, reserved: 36000 },
      { code: 'PL-02', name: '더마', line: 'F1 / L-02', stock: 39000, hold: 4000, output: 24000, recurring: 32000, reserved: 11000 },
    ],
    shipments: [
      { route: '국내 출고', capacity: 180000, booked: 154000 },
      { route: '수출 출고', capacity: 56000, booked: 40000 },
    ],
  },
  {
    start: '2026-08-03',
    label: '8월 3일–9일',
    products: [
      { code: 'PL-01', name: '기초', line: 'F1 / L-01', stock: 84000, hold: 4000, output: 108000, recurring: 84000, reserved: 28000 },
      { code: 'PL-02', name: '더마', line: 'F1 / L-02', stock: 24000, hold: 3000, output: 36000, recurring: 28000, reserved: 8000 },
    ],
    shipments: [
      { route: '국내 출고', capacity: 185000, booked: 119000 },
      { route: '수출 출고', capacity: 65000, booked: 31000 },
    ],
  },
];

export const bids = [
  { id: 'C-201', title: '기초·더마 대형 입찰', route: '수출 출고', demand: { 'PL-01': 30000, 'PL-02': 12000 }, provisional: true, source: example },
  { id: 'C-202', title: '기초 정기 공급 입찰', route: '국내 출고', demand: { 'PL-01': 22000 }, source: '요청 고객: C-202\n품목 및 요청 물량: 기초 PL-01 주 22,000 EA\n결제 통화 및 조건: KRW' },
  { id: 'C-203', title: '더마 수출 입찰', route: '수출 출고', demand: { 'PL-02': 18000 }, source: '요청 고객: C-203\n품목 및 요청 물량: 더마 PL-02 18,000 EA\n결제 통화 및 조건: USD' },
];

export const freeSupply = ({ stock, hold, output, recurring, reserved }) => stock - hold + output - recurring - reserved;
export const freeShipping = ({ capacity, booked }) => capacity - booked;
const sum = (values) => values.reduce((total, value) => total + value, 0);

export function assessBid(bid, week, queue) {
  const shipment = week.shipments.find(({ route }) => route === bid.route);
  const rows = Object.entries(bid.demand).map(([code, requested]) => {
    const product = week.products.find((item) => item.code === code);
    const available = product ? freeSupply(product) : null;
    return { code, requested, available, shortage: available === null ? null : requested - Math.max(available, 0) };
  });
  const requested = sum(rows.map((row) => row.requested));
  const shipping = shipment ? freeShipping(shipment) : null;
  const shippingShortage = shipping === null ? null : requested - Math.max(shipping, 0);
  const competing = queue.filter(({ id }) => id !== bid.id);
  const productConflict = rows.some(({ code, available, requested }) =>
    available !== null && requested + sum(competing.map(({ demand }) => demand[code] ?? 0)) > available
  );
  const shippingConflict = shipping !== null && requested + sum(competing
    .filter(({ route }) => route === bid.route).flatMap(({ demand }) => Object.values(demand))) > shipping;
  const blocked = rows.some(({ shortage }) => shortage > 0) || shippingShortage > 0;
  const incomplete = bid.provisional || shipping === null || rows.some(({ available }) => available === null);
  return {
    rows, requested, shipping, shippingShortage,
    status: incomplete ? 'check' : blocked ? 'short' : 'fit',
    conflict: !blocked && (productConflict || shippingConflict),
  };
}
