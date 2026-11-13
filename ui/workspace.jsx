import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { changeExperience, experienceMode, handsOnExperience, loadState } from '../public/workflow-storage.mjs';
import { bids, weeks } from './supply-overview-data.mjs';
import { CustomerTrends, ProductionOverview, ScenarioLab } from './decision-views.jsx';
import { BidTrial } from './bid-trial-view.jsx';
import './workspace.css';

const pages = {
  home: 'Corevia 약속계획',
  settings: '담당자·메일 등록', inbox: '업무함', task: '배정된 작업', demo: '모의 입찰',
  intake: '입찰 접수', review: '영업 검수', 'intake-result': '영업 검수 결과', history: '고객 자료',
  production: '생산 근거', capacity: '공급안 계산', calculation: '공급안 계산 결과',
  department: '부서 검수', checks: '공급 제약 확인', proposal: '참여 승인',
  submission: '모의 제출', reply: '바이어 회신', audit: '처리 이력', scenario: '시나리오 분석',
};
const nav = [
  ['intake', '입찰 접수', 'intake-request'], ['inbox', '업무함', 'work-inbox'],
  ['settings', '담당자·메일 등록', 'work-mail-panel'], ['audit', '처리 이력', 'workflow-history-page'],
  ['demo', '모의 입찰', 'trial-launch'],
];
const aliases = { 'dashboard-heading': 'intake', dashboard: 'intake', intake: 'intake',
  capacity: 'capacity', 'scenario-heading': 'scenario', assistant: 'intake', 'assistant-heading': 'intake' };
const byId = (id) => document.getElementById(id);
const hash = () => window.location.hash.slice(1);
const viewForHash = () => {
  const anchor = hash();
  if (!anchor) return experienceMode ? 'intake' : 'home';
  if (/^work-mail-[a-f0-9]{64}$/.test(anchor)) return 'task';
  return byId(anchor)?.closest('section[data-view]')?.dataset.view ?? (Object.hasOwn(aliases, anchor) ? aliases[anchor] : 'intake');
};

function useWorkflow() {
  const snapshot = () => {
    const record = loadState('intake');
    const department = loadState('department');
    const plans = !byId('capacity-result').hidden && record && department?.intakeVersion === record.version
      && !department.needsRecalculation ? department.plans ?? [] : [];
    return {
      record, plans, approved: !byId('proposal-document').hidden,
      reviewed: Boolean(plans.length && ['영업','생산관리','재무·전략'].every((role) =>
        department?.reviews?.some(([name, item]) => name === role && item.decision === 'accepted'))),
      submitted: Boolean(loadState('proposal')?.submitted),
      replied: loadState('proposal')?.reply?.type === 'received',
      decision: loadState('proposal')?.approval?.decision,
      next: byId('workflow-next').textContent, href: byId('workflow-next-link').getAttribute('href'),
      outcome: byId('workflow-next-link').dataset.outcome,
    };
  };
  const [workflow, setWorkflow] = useState(snapshot);
  useEffect(() => {
    const update = () => setWorkflow(snapshot());
    const observer = new MutationObserver(update);
    for (const id of ['workflow-next', 'workflow-next-link', 'workflow-steps', 'capacity-result', 'proposal-document']) {
      observer.observe(byId(id), { childList: true, subtree: true, attributes: true });
    }
    window.addEventListener('storage', update);
    update();
    return () => { observer.disconnect(); window.removeEventListener('storage', update); };
  }, []);
  return workflow;
}

function Workspace() {
  const [view, setView] = useState(viewForHash);
  const [intakeStatus, setIntakeStatus] = useState(() => byId('review-form').dataset.ready ? 'ready' : 'loading');
  const intakeReady = intakeStatus === 'ready';
  const workflow = useWorkflow();
  const dialog = byId('assistant-panel');
  const openAssistant = (area) => {
    byId('assistant-context').textContent = area;
    if (!dialog.open) dialog.showModal();
  };
  useEffect(() => {
    const ready = () => setIntakeStatus('ready');
    const timer = window.setTimeout(() => setIntakeStatus((status) => status === 'loading' ? 'delayed' : status), 8000);
    document.addEventListener('corevia:intake-ready', ready);
    if (byId('review-form').dataset.ready) ready();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('corevia:intake-ready', ready);
    };
  }, []);
  useEffect(() => {
    const update = () => {
      if (['assistant-heading', 'assistant'].includes(hash())) {
        history.replaceState(null, '', '#intake-request');
        openAssistant('입찰 접수');
      } else if (dialog.open) dialog.close();
      const next = viewForHash();
      document.body.dataset.workspace = next;
      setView(next);
      const target = byId(hash());
      requestAnimationFrame(() => {
        if (target && !target.closest('[hidden]') && target.matches('fieldset, input')) target.scrollIntoView({ block: 'start' });
        else window.scrollTo(0, 0);
      });
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const title = pages[view];
  const sample = (rawOnly = false) => {
    const bid = bids[0];
    const source = rawOnly
      ? `${bid.source}\n입찰 마감: 2026-07-22\n초도 납품일: 2026-08-02\n확정 납품표: 2026-08-02 PL-01 10000; 2026-08-02 PL-02 6000\n납품표 확인 근거: 체험용 바이어 회신 SIM-BUYER-001\n분할 납품 조건: 일괄 납품`
      : bid.source;
    document.dispatchEvent(new CustomEvent('corevia:open-bid', { detail: {
      source, summary: '모의 입찰서 · 바이어 회신 포함', sample: true, rawOnly,
      context: { customer: bid.id, route: bid.route, selectedWeek: weeks[0].start, weeks },
    } }));
  };
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const startsWithReview = handsOnExperience && params.get('start') === 'review';
    if (!experienceMode || (!startsWithReview && !['normal', 'change'].includes(params.get('case')))
      || hash() !== 'intake-request' || loadState('intake')) return;
    if (startsWithReview) {
      params.delete('start');
      history.replaceState(null, '', `?${params}#intake-request`);
    }
    if (byId('review-form').dataset.ready) sample();
    else {
      const loadSample = () => sample();
      document.addEventListener('corevia:intake-ready', loadSample, { once: true });
      return () => document.removeEventListener('corevia:intake-ready', loadSample);
    }
  }, []);
  useEffect(() => {
    byId('sales-example-entry').hidden = experienceMode;
  }, []);
  return <>
    {portal('workspace-nav', <>
      <a className="workspace-brand" href="?#welcome"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Corevia</strong><small>약속계획</small></span></a>
      <nav aria-label="주 메뉴">
        {nav.map(([key, label, anchor]) => <a key={key} href={`#${anchor}`} aria-current={view === key ? 'page' : undefined}>
          {label}</a>)}
      </nav>
    </>)}
    {portal('workspace-header', <div className="context-bar">
      <div><strong>{title}</strong><span>{experienceMode ? '체험 · 이 탭에만 저장' : 'W05 · 입찰 검토'}</span></div>
      <div>
        {!experienceMode && view !== 'demo' && <a href="#trial-launch">모의 입찰 열기</a>}
        <button type="button" className="secondary" onClick={() => openAssistant(title)}>✦ 업무 어시스턴트</button>
      </div>
    </div>)}
    {portal('workflow-map', ['home', 'settings', 'task', 'inbox', 'audit', 'demo'].includes(view) ? null : <WorkflowMap workflow={workflow} view={view} />)}
    {portal('experience-guide', experienceMode ? <div className="guide-strip">
      <div><strong>{handsOnExperience ? '직접 입력 테스트' : changeExperience ? '조건 변경·재검수 체험' : '정상 제출 체험'}</strong><p>{handsOnExperience && view === 'intake' && !workflow.record
        ? '입찰서를 직접 입력하거나 예시를 채우세요. 조건 추출을 누르면 방금 입력한 내용에서 검수 초안을 만듭니다.'
        : view === 'review' ? '내부 자료와 모의 회신을 읽고 영업 검수 수락을 저장하세요.'
        : view === 'capacity' ? '확정 납품표를 불러와 계산하고 제품 행의 계산 근거를 확인하세요.'
          : view === 'reply' && changeExperience ? '접수 확인으로 마치거나, 감량 요청을 기록해 재검수로 돌아갈 수 있습니다.'
          : view === 'proposal' ? '세 부서가 검수한 공급안의 입찰 참여를 결정하세요.'
            : '모의 자료로 시작해 계산 근거를 확인하고 승인까지 체험하세요.'}</p></div>
      <a href="?#intake-request">일반 검토로 돌아가기</a>
    </div> : null)}
    {portal('hands-on-intake', handsOnExperience ? <div className="hands-on-input">
      <button type="button" className="secondary" data-workflow-action="example" disabled={!intakeReady} onClick={() => sample(true)}>체험용 입찰서 채우기</button>
      <small role="status">{intakeReady ? '채운 값은 수정할 수 있습니다. 조건 추출을 눌러 처리하세요.'
        : intakeStatus === 'delayed' ? '입력 화면 연결이 지연되고 있습니다. 계속 지연되면 이 페이지를 새로고침하세요.' : '입력 화면을 준비하고 있습니다.'}</small>
    </div> : null)}
    {portal('trial-heading', <BidTrial />)}
    {portal('customer-trends', <CustomerTrends />)}
    {portal('production-overview', <ProductionOverview plans={workflow.plans} />)}
    {portal('scenario-view', <ScenarioLab />)}
  </>;
}

function WorkflowMap({ workflow, view }) {
  const { record, plans, reviewed, approved, submitted, replied, next, href, outcome } = workflow;
  const steps = [
    ['접수·자료 확인', '#intake-request', record?.decision === 'accepted'],
    ['공급안 계산', '#capacity-entry', plans.length > 0],
    ['부서 검수', '#department-review', reviewed],
    ['참여 승인', '#proposal-workflow', approved],
    ['모의 제출·회신', '#proposal-document', replied],
  ];
  const destination = steps.findIndex(([, target]) => target === href
    || (target === '#intake-request' && ['#review', '#buyer-change-edit'].includes(href))
    || (target === '#proposal-document' && href === '#buyer-reply-form'));
  const destinationLabel = steps[destination]?.[0] ?? '다음 작업';
  const returnRequired = outcome === 'return';
  const showLink = href && outcome !== 'stop';
  const current = { intake: 0, review: 0, 'intake-result': 0, capacity: 1, calculation: 1, department: 2, checks: 2, proposal: 3, submission: 4, reply: 4 }[view];
  return <nav aria-label="입찰 진행 단계" className="workflow-map">
    <ol>{steps.map(([label, target, complete], index) => <li key={target}>
      <a href={target} aria-current={current === index ? 'step' : undefined}
        data-return={view !== 'scenario' && returnRequired && destination === index ? 'true' : undefined}>
        <span className="workflow-number" aria-hidden="true">{complete ? '✓' : index + 1}</span>
        <strong>{label}</strong><small>{[
          current === index && '현재 화면',
          view !== 'scenario' && returnRequired && destination === index ? '보완 필요'
            : complete ? '완료' : index === 4 && submitted ? '회신 대기'
              : view !== 'scenario' && destination === index && outcome === 'next' ? '다음 작업' : '대기',
        ].filter(Boolean).join(' · ')}</small>
      </a>
    </li>)}</ol>
    <p>{view === 'scenario' ? '테스트 화면 · 승인 기록과 분리' : next}
      {view === 'scenario' ? <a href="#intake-request">입찰 접수로 돌아가기 →</a>
        : showLink && view !== 'reply' && <a href={href} data-workflow-action="fallback">{returnRequired ? `${destinationLabel} 단계로 돌아가기 ↶` : `${destinationLabel} 열기 →`}</a>}</p>
  </nav>;
}

const portal = (id, content) => createPortal(content, byId(id));
createRoot(byId('workspace-root')).render(<Workspace />);
