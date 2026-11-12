import React, { useEffect, useState } from 'react';
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

export function BidTrial() {
  const [seed, setSeed] = useState('');
  const [runSeed, setRunSeed] = useState(null);
  const [input, setInput] = useState(initial);
  const [result, setResult] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [golden, setGolden] = useState(null);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [filled, setFilled] = useState([]);
  const [invalid, setInvalid] = useState(null);
  const [visibleStages, setVisibleStages] = useState(0);
  const stageCount = result?.stages.length ?? 0;
  const presenting = !dirty && visibleStages < stageCount;

  useEffect(() => {
    if (!presenting) return;
    const timer = window.setTimeout(() => setVisibleStages((count) => count + 1), 380);
    return () => window.clearTimeout(timer);
  }, [presenting, result, visibleStages]);

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
      setFilled(prepared.filled);
      setVisibleStages(1);
      setResult(next);
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
    document.addEventListener('corevia:random-trial', randomize);
    return () => document.removeEventListener('corevia:random-trial', randomize);
  }, []);

  function edit(key, value) {
    setInput((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
    setError('');
    setInvalid(null);
  }

  return <div className="analysis-panel trial-panel">
    <div className="section-heading"><h2 id="trial-heading">랜덤 입찰 검증</h2><span className="decision-pill">모의 입력 · 읽기 전용 검증</span></div>
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
      <h3>이번 테스트 실행 내역</h3>
      <ol className="trial-execution" aria-label="모의 실행 단계">{result.stages.map(([label, detail], index) => <li key={label}
        aria-current={presenting && index === visibleStages - 1 ? 'step' : undefined}>
        <strong>{label}</strong><span>{index < visibleStages ? detail : '표시 대기'}</span></li>)}</ol>
      <p className="supply-note">{filled.length ? `기본값 적용 · ${filled.map((key) => `${fieldName(key)} ${defaults[key]}`).join(' · ')}` : '입력한 값으로 계산했습니다.'}</p>
      {presenting ? <button type="button" className="secondary" onClick={() => setVisibleStages(stageCount)}>결과 바로 보기</button> : <>
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
      </>}
    </div>}
    <details className="disclosure-panel"><summary>고정 기대값 회귀 검증</summary>
      <p>수기로 정한 기대값과 실제 계산 결과를 비교합니다. 승인 변경 테스트는 별도 업무 흐름 검증입니다.</p>
      <button type="button" className="secondary" onClick={() => setGolden(runGoldenTrials())}>고정 기대값 검증 실행</button>
      {golden && <div aria-live="polite"><p>{golden.filter((row) => row.passed).length}/{golden.length} 통과</p>
        <ul>{golden.map((row) => <li key={row.label}>{row.label} · {row.passed ? '통과' : '실패'} · 기대 {row.expected.join(' / ')} · 실제 {row.actual.join(' / ')} EA</li>)}</ul></div>}
    </details>
  </div>;
}
