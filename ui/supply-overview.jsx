import React, { useState } from 'react';
import { assessBid, bids, freeShipping, freeSupply, weeks } from './supply-overview-data.mjs';
import { loadState, saveState } from '../public/workflow-storage.mjs';

const number = new Intl.NumberFormat('ko-KR');
const quantity = (value) => value === null ? '미확인' : number.format(value);
const labels = { fit: '검토 가능', short: '조건 조정 필요', check: '추가 확인 필요' };

function BidEntry({ queue, onAdd }) {
  const [notice, setNotice] = useState('');

  function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const id = fields.get('customer').trim().toUpperCase();
    const demand = Object.fromEntries(['PL-01', 'PL-02'].map((code) => [code, Number(fields.get(code))])
      .filter(([, value]) => value > 0));
    if (!/^C-\d{3}$/.test(id) || !Object.keys(demand).length) {
      setNotice('고객 코드와 최소 한 품목의 비교 물량을 입력하세요.');
      return;
    }
    const title = fields.get('title').trim();
    if (!title) {
      setNotice('입찰 제목을 입력하세요.');
      return;
    }
    const route = fields.get('route');
    const bid = {
      id: crypto.randomUUID(), customer: id, title, route, demand, provisional: true,
      source: `${fields.get('source').trim()}\n요청 고객: ${id}`.trim(),
    };
    const updated = [...queue, bid];
    if (!saveState('bid-queue', updated)) {
      setNotice('브라우저에 입찰을 저장하지 못했습니다.');
      return;
    }
    onAdd(updated, bid.id);
    form.reset();
    setNotice('입찰을 대기열에 추가했습니다.');
  }

  return <details className="bid-entry">
    <summary>새 입찰 추가</summary>
    <form onSubmit={submit}>
      <div className="fields">
        <label>고객 코드<input name="customer" placeholder="C-204" maxLength={5} required /></label>
        <label>입찰 제목<input name="title" maxLength={80} required /></label>
        <label>출고 경로<select name="route"><option>국내 출고</option><option>수출 출고</option></select></label>
        <label>PL-01 비교 물량 (EA)<input name="PL-01" type="number" min="0" max="999999999" step="1" /></label>
        <label>PL-02 비교 물량 (EA)<input name="PL-02" type="number" min="0" max="999999999" step="1" /></label>
      </div>
      <label>RFP 원문 또는 추가 조건<textarea name="source" rows="3" maxLength={12000} /></label>
      <button type="submit">대기열에 추가</button>
      <p role="status">{notice}</p>
    </form>
  </details>;
}

function SupplyTable({ title, headers, rows }) {
  return <div className="supply-table">
    <h3>{title}</h3>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={title}>
      <table>
        <thead><tr>{headers.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(([label, ...values]) => <tr key={label}>
          <th scope="row">{label}</th>
          {values.map((value, index) => <td key={headers[index + 1]}>{typeof value === 'number' ? quantity(value) : value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

export function SupplyOverview() {
  const [extraBids, setExtraBids] = useState(() => loadState('bid-queue') ?? []);
  const [weekIndex, setWeekIndex] = useState(0);
  const [bidId, setBidId] = useState(bids[0].id);
  const [handoff, setHandoff] = useState(false);
  const week = weeks[weekIndex];
  const queue = [...bids, ...extraBids];
  const bid = queue.find(({ id }) => id === bidId);
  const customer = bid.customer ?? bid.id;
  const assessment = assessBid(bid, week, queue);
  const { rows, status, shipping, shippingShortage, requested, conflict } = assessment;

  function openIntake() {
    document.dispatchEvent(new CustomEvent('corevia:open-bid', { detail: {
      source: bid.source,
      summary: `${customer} · 2026년 ${week.label} · ${labels[status]}`,
      context: { customer, route: bid.route, selectedWeek: week.start, weeks },
    } }));
    window.location.hash = 'intake-request';
  }

  return <div className="supply-overview">
    <div className="section-heading">
      <div>
        <h3>주간 공급 현황</h3>
        <p className="supply-note">시연용 모의 데이터 · 2026년 · 수량 단위 EA</p>
      </div>
      <label>검토 주간
        <select value={weekIndex} onChange={(event) => { setWeekIndex(Number(event.target.value)); setHandoff(false); }}>
          {weeks.map(({ label }, index) => <option key={label} value={index}>{label}</option>)}
        </select>
      </label>
    </div>
    <div className="supply-grid">
      <SupplyTable title="완제품 재고" headers={['품목', '주초 재고', '품질 보류', '사용 가능']}
        rows={week.products.map((p) => [`${p.code} ${p.name}`, p.stock, p.hold, p.stock - p.hold])} />
      <SupplyTable title="생산 현황" headers={['품목', '라인', '주간 입고 예정']}
        rows={week.products.map((p) => [p.code, p.line, p.output])} />
      <SupplyTable title="기존 공급 약속과 예약" headers={['품목', '확정 공급', '별도 예약', '신규 공급 여력']}
        rows={week.products.map((p) => [p.code, p.recurring, p.reserved, freeSupply(p)])} />
      <SupplyTable title="출고·물류 예약" headers={['경로', '처리 한도', '예약 완료', '추가 출고 여력']}
        rows={week.shipments.map((s) => [s.route, s.capacity, s.booked, freeShipping(s)])} />
    </div>
    <p className="supply-note">신규 공급 여력 = 사용 가능 재고 + 주간 입고 예정 − 확정 공급 − 별도 예약. 물류는 출고 경로별로 따로 확인합니다.</p>

    <h3>입찰 대기열 <span className="supply-count">{queue.length}건</span></h3>
    <div className="bid-queue" role="group" aria-label="검토할 입찰">
      {queue.map((item) => {
        const result = assessBid(item, week, queue);
        return <button type="button" className="bid-option" aria-pressed={bidId === item.id} key={item.id}
          onClick={() => { setBidId(item.id); setHandoff(false); }}>
          <small>{item.customer ?? item.id} · {item.route}</small>
          <strong>{item.title}</strong>
          <span className={`supply-status ${result.status}`}>{labels[result.status]}</span>
        </button>;
      })}
    </div>
    <BidEntry queue={extraBids} onAdd={(updated, id) => { setExtraBids(updated); setBidId(id); setHandoff(false); }} />
    <div className="bid-assessment" aria-label="선택 입찰 1차 판단">
      <div className="section-heading"><h3>{customer} 1차 판단</h3><strong className={`supply-status ${status}`}>{labels[status]}</strong></div>
      {bid.provisional && <p>초도일과 주차별 물량이 미확정입니다. 아래 요청 수량은 비교용 가정입니다.</p>}
      <SupplyTable title="요청량 대비 공급·출고 여력" headers={['항목', '요청 수량', '가용 수량', '추가 확보 필요']}
        rows={[
          ...rows.map(({ code, requested, available, shortage }) => [code, requested, quantity(available), quantity(shortage === null ? null : Math.max(shortage, 0))]),
          [bid.route, requested, quantity(shipping), quantity(shippingShortage === null ? null : Math.max(shippingShortage, 0))],
        ]} />
      <ul className="bid-actions">
        {rows.some(({ shortage }) => shortage > 0) && <li>생산관리 · 부족 품목의 입고 가능일과 추가 생산 여력을 확인하세요.</li>}
        {shippingShortage > 0 && <li>물류 · 추가 출고 한도를 확보하거나 영업과 분할 출고 일정을 검토하세요.</li>}
        {conflict && <li>동시 입찰 주의 · 대기 중인 입찰을 함께 받으면 같은 주간 여력이 부족할 수 있습니다.</li>}
        {status === 'fit' && <li>영업 · 실제 초도 일정과 수량을 확인하고 부서 검수로 넘기세요.</li>}
        {status === 'check' && <li>영업 · 초도일과 분할 납품 조건을 바이어에게 확인하세요.</li>}
      </ul>
      <p className="supply-note">각 입찰은 기존 약속을 먼저 차감해 개별 검토합니다. 여기서는 수량이 예약되지 않습니다.</p>
      {handoff ? <div className="bid-handoff">
        <p>현재 편집 중인 접수 초안을 선택한 입찰로 바꿉니다. 저장된 검수 기록은 접수 화면에서 새 검수 결과를 저장할 때 갱신됩니다.</p>
        <button type="button" onClick={openIntake}>선택한 입찰 불러오기</button>
        <button type="button" className="secondary" onClick={() => setHandoff(false)}>취소</button>
      </div> : <button type="button" onClick={() => {
        const current = document.getElementById('request').value;
        if (current && current !== bid.source) setHandoff(true);
        else openIntake();
      }}>이 입찰 상세 검증 시작</button>}
    </div>
  </div>;
}
