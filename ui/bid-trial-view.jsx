import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { capacityTrace } from '../public/capacity-plan.mjs';
import { defaults, generateTrial, prepareTrial, runGoldenTrials, runTrial } from './bid-trial.mjs';

const fields = [
  ['capacity1', '기초 공급능력'], ['capacity2', '더마 공급능력'],
  ['existing1', '기초 기존 약속'], ['existing2', '더마 기존 약속'],
  ['demand1', '기초 신규 요청'], ['demand2', '더마 신규 요청'],
  ['extra', 'C-101 추가 더마 주문'], ['shipping', '공동 출고 한도'], ['booked', '기존 출고 예약'],
  ['expansion', '더마 증설량'],
];
const initial = Object.fromEntries(Object.keys(defaults).map((key) => [key, '']));
const fieldName = (key) => fields.find(([name]) => name === key)?.[1] ?? '증설 가동일';
const ea = (quantity) => `${quantity.toLocaleString('ko-KR')} EA`;
const productName = (code) => code === 'PL-01' ? '기초' : '더마';
const sceneLabels = ['입찰 접수', '기존 납품 우선 배정', '신규 공급안 계산', '검증과 다음 작업'];

function TrialPlayback({ result, onClose, onShowResult }) {
  const dialog = useRef(null);
  const scene = useRef(null);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const last = sceneLabels.length - 1;
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    scene.current.scrollTop = 0;
  }, [step]);
  useEffect(() => {
    if (paused || step === last) return;
    const timer = window.setTimeout(() => setStep(step + 1), 4200);
    return () => window.clearTimeout(timer);
  }, [paused, step, last]);

  function move(index) {
    setPaused(true);
    setStep(index);
  }

  const { plans, checks, expected, action, values, filled, expansion } = result;
  const logistics = plans[0].shipping;
  return <dialog className="trial-player" aria-labelledby="trial-player-heading" ref={dialog} onClose={onClose}>
    <header className="trial-player-header">
      <div><p>Corevia · 모의 입찰 시연</p><h2 id="trial-player-heading">입찰 요청은 어떻게 공급안이 되나요?</h2></div>
      <button type="button" className="secondary" aria-label="시연 닫기" onClick={() => dialog.current.close()}>닫기</button>
    </header>
    <ol className="trial-player-steps" aria-label="모의 실행 단계">
      {sceneLabels.map((label, index) => <li key={label}><button type="button" onClick={() => move(index)}
        aria-current={index === step ? 'step' : undefined}>
        <span aria-hidden="true">{index + 1}</span>{label}</button></li>)}
    </ol>
    <div className="trial-player-scene" ref={scene} aria-live="polite" aria-atomic="true"><div className="trial-scene-content" key={step}>
      {step === 0 && <>
        <h3>C-201의 입찰 요청을 읽습니다</h3>
        <p>품목별 요청량과 납품일을 추출해 계산에 넘깁니다.</p>
        <dl className="trial-player-facts">
          <div><dt>기초 요청량</dt><dd>{ea(values.demand1)}</dd><small>{filled.includes('demand1') ? '모의 기본값' : '이번 실행 입력값'}</small></div>
          <div><dt>더마 요청량</dt><dd>{ea(values.demand2)}</dd><small>{filled.includes('demand2') ? '모의 기본값' : '이번 실행 입력값'}</small></div>
          <div><dt>초도 납품일</dt><dd>{plans[0].deliveryDate}</dd><small>모의 입찰서</small></div>
        </dl>
        <p className="trial-player-note">{filled.length ? `빈 항목 ${filled.length}개에 모의 기본값을 적용했습니다. 입력한 값과 0은 그대로 사용합니다.` : '이번 실행의 모든 항목에 입력된 값을 사용합니다.'}</p>
      </>}
      {step === 1 && <>
        <h3>기존 고객에게 약속한 물량부터 배정합니다</h3>
        <p>각 품목의 생산능력에서 기존 확정 물량을 먼저 빼고 남은 여력을 확인합니다.</p>
        <dl className="trial-player-facts">{plans.map((plan) => {
          const { effective, existing } = capacityTrace(plan, plans);
          return <div key={plan.product}><dt>{productName(plan.product)} · {plan.line}</dt><dd>{ea(Math.max(0, effective - existing))} 남음</dd>
            <small>생산 {ea(effective)} − 기존 약속 {ea(existing)}</small>
            {plan.revised.existingShortage > 0 && <strong className="trial-player-warning">기존 납품 {ea(plan.revised.existingShortage)} 부족</strong>}</div>;
        })}</dl>
        <p className="trial-player-note">더마 증설 예정 {ea(values.expansion)} · 가동일 {values.start} · 납품일까지 반영 {ea(expansion)}</p>
      </>}
      {step === 2 && <>
        <h3>남은 생산량과 출고 여력으로 공급안을 계산합니다</h3>
        <p>두 품목은 같은 출고 여력을 사용합니다. 기초에 먼저 배정하고 남은 한도를 더마에 적용합니다.</p>
        <p className="trial-player-note">공동 출고 {ea(logistics.capacity)} − 기존 예약 {ea(logistics.booked)} = {ea(Math.max(0, logistics.capacity - logistics.booked))} 사용 가능</p>
        <dl className="trial-player-facts">{plans.map((plan) => {
          const { production, shippingAvailable } = capacityTrace(plan, plans);
          return <div key={plan.product}><dt>{productName(plan.product)} · 신규 배정</dt><dd>{ea(plan.revised.proposal)}</dd>
            <small>생산 기준 {ea(production)} · 배정 전 남은 출고 {ea(shippingAvailable)}</small>
            {plan.unmetRequest > 0 && <strong className="trial-player-warning">요청량 중 {ea(plan.unmetRequest)} 미충족</strong>}</div>;
        })}</dl>
      </>}
      {step === last && <>
        <h3>{action}</h3>
        <p>공급안의 배정량을 독립 계산과 대조했습니다. 모의 검증이 끝나면 담당자가 근거를 보고 결정합니다.</p>
        <dl className="trial-player-facts">
          <div><dt>계산 검증</dt><dd>{checks.filter(([, pass]) => pass).length}/{checks.length} 통과</dd><small>기존 납품, 공동 출고, 증설 시점 포함</small></div>
          {plans.map((plan, index) => <div key={plan.product}><dt>{productName(plan.product)} · 배정량</dt><dd>{ea(plan.revised.proposal)}</dd><small>독립 계산 {ea(expected[index])}</small></div>)}
        </dl>
        <p className="trial-player-note">모의 실행 완료 · 담당자 승인과 제출 기록은 생성되지 않았습니다.</p>
      </>}
    </div></div>
    <footer className="trial-player-footer">
      <div>
        <button type="button" className="secondary" disabled={step === 0} onClick={() => move(step - 1)}>이전</button>
        {step === last ? <button type="button" className="secondary" onClick={() => { setStep(0); setPaused(false); }}>다시 재생</button>
          : <><button type="button" className="secondary" onClick={() => setPaused(!paused)}>{paused ? '계속 재생' : '일시정지'}</button>
            <button type="button" className="secondary" onClick={() => move(step + 1)}>다음</button></>}
      </div>
      <button type="button" onClick={() => { dialog.current.close(); onShowResult(); }}>결과 바로 보기</button>
    </footer>
  </dialog>;
}

export function BidTrial() {
  const [seed, setSeed] = useState('');
  const [runSeed, setRunSeed] = useState(null);
  const [input, setInput] = useState(initial);
  const [result, setResult] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [golden, setGolden] = useState(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [invalid, setInvalid] = useState(null);
  const [playing, setPlaying] = useState(false);
  const resultHeading = useRef(null);

  function calculate(values, generated) {
    setError('');
    setInvalid(null);
    const prepared = prepareTrial(values);
    if (prepared.errorKey) {
      setInvalid(prepared.errorKey);
      setResult(null);
      setError(`${fieldName(prepared.errorKey)} 값을 확인하세요. 수량은 0~500 EA 정수이며 신규 요청은 1 EA 이상입니다.`);
      requestAnimationFrame(() => {
        const field = document.getElementById(`trial-${prepared.errorKey}`);
        if (field) { field.closest('details').open = true; field.focus(); }
      });
      return;
    }
    try {
      const next = runTrial(prepared.values);
      setResult({ ...next, values: prepared.values, filled: prepared.filled });
      setPlaying(true);
      setDirty(false);
      if (generated) setBaseline(next);
    } catch (failure) {
      setResult(null);
      setError(failure.message);
    }
  }

  function replay(value) {
    if (!/^\d{1,10}$/.test(value) || Number(value) > 4294967295) {
      setError('재현 번호는 0~4294967295 범위의 정수입니다.');
      return;
    }
    const values = generateTrial(Number(value));
    setSeed(String(Number(value)));
    setRunSeed(Number(value));
    setInput(values);
    calculate(values, true);
  }

  function randomize() { replay(String(crypto.getRandomValues(new Uint32Array(1))[0])); }

  useEffect(() => {
    const button = document.getElementById('dashboard-trial-start');
    function startWithDefaults() {
      setSeed('');
      setRunSeed(null);
      setBaseline(null);
      setInput(initial);
      calculate(initial, false);
    }
    button.disabled = false;
    button.addEventListener('click', startWithDefaults);
    return () => {
      button.removeEventListener('click', startWithDefaults);
      button.disabled = true;
    };
  }, []);

  function showResult() {
    if (document.body.dataset.workspace !== 'scenario') {
      window.addEventListener('hashchange', () => requestAnimationFrame(() => resultHeading.current?.focus()), { once: true });
      window.location.hash = 'trial-heading';
    } else requestAnimationFrame(() => resultHeading.current?.focus());
  }

  function edit(key, value) {
    setInput((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setError('');
    setInvalid(null);
  }

  return <div className="analysis-panel trial-panel">
    <div className="section-heading"><h2>랜덤 입찰 검증</h2><span className="decision-pill">모의 입력 · 읽기 전용 검증</span></div>
    <p>모의 입찰서에서 조건을 추출하고 실제 공급계획 계산과 납품표 검증을 실행합니다. 승인·제출 기록에는 반영되지 않습니다.</p>
    <div className="trial-actions">
      <button type="button" onClick={randomize}>새 랜덤 입찰 실행</button>
      <button type="button" className="secondary" onClick={() => calculate(input, false)}>테스트 진행하기</button>
      <form onSubmit={(event) => { event.preventDefault(); replay(seed); }}>
        <label>재현 번호<input value={seed} onChange={(event) => setSeed(event.target.value)} inputMode="numeric" maxLength={10} /></label>
        <button className="secondary" type="submit">같은 입력 재현</button>
      </form>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); calculate(input, false); }}>
      <details className="disclosure-panel"><summary>생성된 입력 확인·수정</summary>
        <div className="scenario-inputs">{fields.map(([key,label]) => <label key={key}>{label} (EA)
          <input id={`trial-${key}`} type="text" inputMode="numeric" aria-invalid={invalid === key} value={input[key]} placeholder={String(defaults[key])}
            onChange={(event) => edit(key,event.target.value)} /></label>)}
        <label>증설 가동일<select id="trial-start" value={input.start} onChange={(event) => edit('start',event.target.value)}>
          <option value="">기본값 · 납품일</option>
          <option value="2026-08-02">2026-08-02 · 납품일</option><option value="2026-08-03">2026-08-03 · 납품 이후</option>
        </select></label></div>
        <button type="submit">수정한 조건 다시 계산</button>
        <p className="supply-note">빈 칸만 기본값으로 계산합니다. 입력한 0은 그대로 사용합니다. 재현 번호는 처음 생성된 입력을 복원합니다.</p>
      </details>
    </form>
    {error && <p role="alert">{error}</p>}
    {dirty && <p role="status">입력 수정됨 · 다시 계산해야 현재 결과를 확인할 수 있습니다.</p>}
    {result && !dirty && <div className="trial-results">
      <div className="section-heading"><h3 ref={resultHeading} tabIndex={-1}>이번 테스트 실행 내역</h3>
        <button type="button" className="secondary" onClick={() => setPlaying(true)}>시연 다시 보기</button></div>
      {playing && createPortal(<TrialPlayback result={result} onClose={() => setPlaying(false)}
        onShowResult={showResult} />, document.body)}
      <p className="supply-note">{result.filled.length ? `기본값 적용 · ${result.filled.map((key) => `${fieldName(key)} ${defaults[key]}`).join(' · ')}` : '입력한 값으로 계산했습니다.'}</p>
      <h3>{result.action}</h3>
      <p>{runSeed !== null && `원본 재현 번호 ${runSeed} · `}납품일 2026-08-02 · 증설 반영 {result.expansion} EA · 품목 순서대로 공동 출고 한도를 배정합니다.</p>
      <div className="table-scroll"><table>
        <thead><tr>{['품목','신규 요청','실제 배정','독립 기대값','신규 미충족','기존 부족','첫 실행 대비'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{result.plans.map((row,index) => <tr key={row.product}>
          <th scope="row">{row.product}</th><td>{row.requested}</td><td>{row.revised.proposal}</td><td>{result.expected[index]}</td>
          <td>{row.unmetRequest}</td><td>{row.revised.existingShortage}</td>
          <td>{baseline ? row.revised.proposal - baseline.plans[index].revised.proposal : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      <ul>{result.checks.map(([label,pass]) => <li key={label}>{label} · <strong>{pass ? '통과' : '실패'}</strong></li>)}</ul>
      <details><summary>생성된 요청서와 납품표 불일치 확인</summary><pre>{result.source}</pre>
        {result.issues.length > 0 && <ul>{result.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</details>
    </div>}
    <details className="disclosure-panel"><summary>고정 기대값 회귀 검증</summary>
      <p>수기로 정한 기대값과 실제 계산 결과를 비교합니다. 승인 변경 테스트는 별도 업무 흐름 검증입니다.</p>
      <button type="button" className="secondary" onClick={() => setGolden(runGoldenTrials())}>고정 기대값 검증 실행</button>
      {golden && <div aria-live="polite"><p>{golden.filter((row) => row.passed).length}/{golden.length} 통과</p>
        <ul>{golden.map((row) => <li key={row.label}>{row.label} · {row.passed ? '통과' : '실패'} · 기대 {row.expected.join(' / ')} · 실제 {row.actual.join(' / ')} EA</li>)}</ul></div>}
    </details>
  </div>;
}
