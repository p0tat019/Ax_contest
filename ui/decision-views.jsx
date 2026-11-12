import React, { useState } from 'react';
import evidence from '../public/intake-data.json';
import { compareCapacity, expansionAvailable, readQuantity } from '../public/capacity-plan.mjs';
import { deliverySchedule } from '../public/proposal-checks.mjs';
import { weeks, bids, assessBid, freeSupply } from './supply-overview-data.mjs';

const number = new Intl.NumberFormat('ko-KR');
const ea = (value) => `${number.format(value)} EA`;
const total = (rows, field) => rows.reduce((sum, row) => sum + field(row), 0);

export function DecisionOverview({ record, plans, next, href, approved, decision }) {
  const [weekIndex, setWeek] = useState(0);
  const week = weeks[weekIndex];
  const customer = record?.conditions?.customer ?? 'C-201';
  const previewBid = bids.find(({ id }) => id === customer);
  const preview = previewBid ? assessBid(previewBid, week, bids) : null;
  const volume = plans.length ? ea(total(plans, (row) => row.revised.proposal)) : '미산정';
  let schedule = [];
  try {
    if (record?.conditions?.deliveryEvidence) schedule = deliverySchedule(record.conditions.deliverySchedule);
  } catch {
    // Invalid or incomplete schedules stay unverified in the decision view.
  }
  const existingShort = total(plans, (row) => row.revised.existingShortage);
  const issueCount = document.getElementById('proposal-issues').children.length;
  const unallocated = total(plans, (row) => row.unmetRequest);
  return <div className="decision-overview">
    <div className="decision-intro">
      <div>
        <p className="eyebrow">{record ? '현재 검토 건' : '대표 검토 건'}</p>
        <h1>{customer} 입찰 검토</h1>
        <p>기존 고객의 납품 약속을 보호하며 제안 가능한 조건을 판단합니다.</p>
      </div>
      <span className={`decision-pill ${approved ? 'is-approved' : ''}`}>{approved ? '참여 승인' : decision === 'declined' ? '참여 보류' : decision === 'returned' ? '보완 요청' : record ? '검토 중' : '자료 확인 필요'}</span>
    </div>
    <div className="decision-metrics">
      {[
        ['납품표 요청량', schedule.length ? ea(total(schedule, (row) => row.quantity)) : '미확인', '바이어 회신 근거를 기록한 납품표'],
        [approved ? '승인된 제안량' : '계산된 제안량', volume, approved ? '입찰 참여 조건 · 모의 제출' : '최종 승인 전 제안 후보'],
        ['기존 납품 부족', plans.length ? ea(existingShort) : '검증 필요', '계산에 입력한 확정 약속 기준'],
        ['증설 판단', '미판정', '라인·투자비·수익성 근거 필요'],
      ].map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}
    </div>
    <div className="decision-body">
      <div className="analysis-panel">
        <div className="section-heading"><h2>{plans.length ? '공급 가능성' : '공급 여력 미리보기'}</h2>
          <span className="source-label">{plans.length ? '현재 공급안 · 계산 결과' : preview ? `${customer} · 시연 가정` : '자료 확인 필요'}</span>
        </div>
        {plans.length ? <>
          <p>{unallocated ? `요청 대비 ${ea(unallocated)}를 배정하지 못했습니다.` : '계산 대상 요청량을 모두 배정했습니다.'}
            {issueCount > 0 && ` 승인 전 확인 사항 ${issueCount}건.`}</p>
          <PlanTimeline plans={plans} />
        </> : preview ? <>
          <label className="compact-label">검토 주간<select value={weekIndex} onChange={(event) => setWeek(Number(event.target.value))}>
            {weeks.map((item, index) => <option value={index} key={item.start}>{item.label}</option>)}
          </select></label>
          <CompareBar label={previewBid.route} requested={preview.requested} available={preview.shipping} />
          <p className="supply-note">가정 물량 기준 {ea(Math.max(0, preview.shippingShortage))}의 출고 여력이 더 필요합니다. 확정 납품표를 확인하면 다시 계산할 수 있습니다.</p>
        </> : <p>이 입찰의 주간 요청량과 출고 여력을 등록하면 공급안에서 확인할 수 있습니다.</p>}
      </div>
      <div className="decision-next">
        <span className="eyebrow">다음 결정</span><h2>{approved ? '승인 조건과 후속 업무' : '검토를 진행하려면'}</h2>
        <p>{next || '영업 담당자가 입찰 요청과 확정 납품 조건을 확인하세요.'}</p>
        {record && <a className="primary-link" href={href || '#intake-request'}>{href === '#capacity-entry' ? '공급안 계산 열기' : href === '#department-review' ? '부서 검수 열기' : '필요한 작업 열기'} <span aria-hidden="true">→</span></a>}
        <a className="text-link" href="#scenario-heading">가정으로 시나리오 비교</a>
      </div>
    </div>
  </div>;
}

function CompareBar({ label, requested, available }) {
  const max = Math.max(requested, available, 1);
  return <div className="comparison-bar">
    <strong>{label}</strong>
    <div><span>요청</span><meter min="0" max={max} value={requested} /><b>{ea(requested)}</b></div>
    <div><span>가용</span><meter min="0" max={max} value={Math.max(0, available)} /><b>{ea(available)}</b></div>
  </div>;
}

function PlanTimeline({ plans }) {
  return <div className="plan-timeline">
    {plans.map((row) => <details className={row.revised.existingShortage || row.unmetRequest ? 'has-conflict' : ''} key={`${row.week}/${row.line}/${row.product}`}>
      <summary><span>{row.week} · {row.product}</span><strong>{ea(row.revised.proposal)}</strong>
        <small>{row.revised.existingShortage ? '기존 납품 부족' : row.unmetRequest ? '신규 요청 미충족' : '계산상 배정'}</small>
        <meter min="0" max={Math.max(1, row.requested, row.revised.proposal)} value={row.revised.proposal}
          aria-label={`요청 ${ea(row.requested)} 중 제안 ${ea(row.revised.proposal)}`} /></summary>
      <p>라인 {row.plant}/{row.line} · 납품 {row.deliveryDate || '미확인'} · 요청 {ea(row.requested)} · 기존 부족 {ea(row.revised.existingShortage)}</p>
      <p>기준 제안 {ea(row.baseline.proposal)} → 변경 제안 {ea(row.revised.proposal)}{row.shipping?.restricted ? ` · 출고 제약 ${ea(row.shipping.restricted)}` : ''}</p>
    </details>)}
  </div>;
}

export function ProductionOverview({ plans }) {
  return <div className="analysis-panel">
    <div className="section-heading"><h2>주차별 생산과 납기</h2><span className="source-label">{plans.length ? '현재 공급안' : '시연 가정'}</span></div>
    {plans.length ? <PlanTimeline plans={plans} /> : <div className="week-grid">
      {weeks.map((week) => <div key={week.start}><h3>{week.label}</h3>
        {week.products.map((row) => <details key={row.code}><summary>{row.name} · {row.line} <strong>{ea(freeSupply(row))}</strong></summary>
          <p>사용 가능 재고 {ea(row.stock - row.hold)} · 입고 {ea(row.output)}</p>
          <p>확정 공급 {ea(row.recurring)} · 별도 예약 {ea(row.reserved)}</p>
        </details>)}
      </div>)}
    </div>}
    <p className="supply-note">주간 가용량은 제품별 생산·재고 기준입니다. 공동 출고 한도는 공급안 계산에 따로 반영됩니다.</p>
    <a className="text-link" href="#scenario-heading">검수 전 가정 계산 열기 →</a>
  </div>;
}

export function CustomerTrends() {
  const history = evidence.existingCustomer.monthly ?? [];
  const max = Math.max(1, ...history.flatMap((row) => [row.orders, row.shipments]));
  return <div className="analysis-panel">
    <div className="section-heading"><h2>C-101 발주·출하 추이</h2><span className="source-label">대회 제공 데이터 · 월별 집계</span></div>
    <p>발주는 주문일, 출하는 출하일 기준입니다. 확정 잔여 납기는 계약과 주문 대조가 필요합니다.</p>
    <div className="trend-grid">
      {['orders', 'shipments'].map((key) => <div className={`trend-series ${key}`} key={key}>
        <h3>{key === 'orders' ? '신규 발주량' : '출하량'}</h3>
        {history.length ? history.map((row) => <div key={row.month}><span>{row.month}</span>
          <meter min="0" max={max} value={row[key]} aria-label={`${row.month} ${ea(row[key])}`} /><b>{number.format(row[key])}</b></div>) : <p>월별 자료가 없습니다.</p>}
      </div>)}
    </div>
    <details><summary>집계 출처</summary><p>{evidence.existingCustomer.sources.join(' · ')}</p></details>
  </div>;
}

export function ScenarioLab() {
  const [weekIndex, setWeek] = useState(0);
  const [commissioning, setCommissioning] = useState('');
  const [inputs, setInputs] = useState({ growth: '', export: '', cost: '', margin: '' });
  const week = weeks[weekIndex];
  const end = new Date(`${week.start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const deadline = end.toISOString().slice(0, 10);
  const shipping = week.shipments.find((row) => row.route === '수출 출고');
  const basis = week.products.map((product, index) => ({
    week: week.start, deliveryDate: deadline, product: product.code, plant: 'F1', line: `L-0${index + 1}`,
    capacity: product.stock - product.hold + product.output, commitments: product.recurring + product.reserved,
    requested: bids[0].demand[product.code], additional: 0, reduction: 0, source: '시연용 주간 공급 가정',
  }));
  const parsed = Object.fromEntries(Object.entries(inputs).map(([key, raw]) => [key, readQuantity(raw)]));
  const invalid = (key) => parsed[key] !== null && !(parsed[key] >= 0 && parsed[key] <= 1000000000000);
  const valid = !Object.keys(inputs).some(invalid);
  const modes = [
    ['현상 유지', basis.map((row) => ({ ...row, requested: 0 })), 0],
    ['부분 공급', basis, 0],
    ['증설 가정', basis.map((row) => ({ ...row, capacity: row.capacity + (row.product === 'PL-02'
      ? expansionAvailable(parsed.growth ?? 0, commissioning, deadline) : 0) })), parsed.export ?? 0],
  ];
  return <div className="analysis-panel">
    <div className="section-heading"><h1 id="scenario-heading">시나리오 분석</h1><span className="decision-pill">미검증 · 가정 계산</span></div>
    <p>기존 납품을 먼저 배정한 뒤 신규 요청의 생산 여력과 수출 한도를 비교합니다. 가정은 승인 자료에 반영되지 않습니다.</p>
    <div className="scenario-inputs">
      <label>검토 주간<select value={weekIndex} onChange={(event) => setWeek(Number(event.target.value))}>
        {weeks.map((item, index) => <option value={index} key={item.start}>{item.label}</option>)}</select></label>
      {[
        ['growth', '더마 증설분 (EA)'], ['export', '추가 수출 한도 (EA)'],
        ['cost', '투자비 (원)'], ['margin', '평균 공헌이익 (원/EA)'],
      ].map(([key, label]) => <label key={key}>{label}<input type="text" inputMode="numeric" aria-invalid={invalid(key)} value={inputs[key]} placeholder="미입력"
        onChange={(event) => setInputs((previous) => ({ ...previous, [key]: event.target.value }))} /></label>)}
      <label>증설 설비 가동 예정일<input type="date" value={commissioning} onChange={(event) => setCommissioning(event.target.value)} /></label>
    </div>
    <p className="supply-note">대상 C-201 · 비교 요청 {ea(total(basis, (row) => row.requested))} · 시연 데이터입니다. 비교 납품일은 {deadline}이며, 증설량은 이 날짜까지 가동 가능한 경우에만 반영됩니다.</p>
    {!valid ? <p role="alert">가정값은 0 이상 1조 이하의 정수로 입력하세요.</p> : <div className="scenario-cards">
      {modes.map(([label, rows, additionalExport], index) => {
        const plans = compareCapacity(rows, new Map([[week.start, { capacity: shipping.capacity + additionalExport, booked: shipping.booked, source: '시연용 수출 한도' }]]));
        const offered = total(plans, (row) => row.revised.proposal);
        const shortage = total(plans, (row) => row.revised.existingShortage);
        const outstanding = index === 0 ? total(basis, (row) => row.requested) : total(plans, (row) => row.unmetRequest);
        const contribution = parsed.margin === null ? null : BigInt(offered) * BigInt(parsed.margin);
        return <article key={label}><h2>{label}</h2><strong>{ea(offered)}</strong><small>신규 공급 후보</small>
          <dl><dt>신규 요청 미배정</dt><dd>{ea(outstanding)}</dd><dt>기존 납품 부족</dt><dd>{ea(shortage)}</dd>
            <dt>주간 공헌이익</dt><dd>{contribution === null ? '미산정' : `${number.format(contribution)}원`}</dd>
            <dt>일회성 투자비</dt><dd>{index !== 2 ? '추가 투자 없음' : parsed.cost === null ? '미입력' : `${number.format(parsed.cost)}원`}</dd></dl>
        </article>;
      })}
    </div>}
    <p className="supply-note">주간 공헌이익은 제안 후보량 × 입력한 평균 단위 공헌이익입니다. 일회성 투자비와 별도로 표시합니다.</p>
  </div>;
}
