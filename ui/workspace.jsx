import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { experienceMode, loadState } from '../public/workflow-storage.mjs';
import { bids, weeks } from './supply-overview-data.mjs';
import { CustomerTrends, DecisionOverview, ProductionOverview, ScenarioLab } from './decision-views.jsx';
import { SupplyOverview } from './supply-overview.jsx';
import { BidTrial } from './bid-trial-view.jsx';
import './workspace.css';

const pages = [
  ['dashboard', '종합 현황', 'dashboard-heading', '◫'],
  ['intake', '고객·계약', 'customer-history', '▤'],
  ['capacity', '생산계획', 'capacity', '▥'],
  ['scenario', '시나리오 분석', 'scenario-heading', '◈'],
  ['proposal', '검수·승인', 'proposal-workflow', '✓'],
];
const aliases = { review: 'intake', reviewer: 'intake', result: 'intake', 'intake-request': 'intake', 'capacity-result': 'capacity', 'capacity-entry': 'capacity',
  'department-review': 'proposal', 'approval-evidence': 'proposal', 'workflow-history': 'proposal', 'proposal-document': 'proposal',
  'buyer-reply-form': 'proposal', 'trial-heading': 'scenario' };
const byId = (id) => document.getElementById(id);
const hash = () => window.location.hash.slice(1);
const viewForHash = () => pages.find(([id, , anchor]) => id === hash() || anchor === hash())?.[0] ?? aliases[hash()] ?? 'dashboard';

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
  const [anchor, setAnchor] = useState(hash);
  const workflow = useWorkflow();
  const dialog = byId('assistant-panel');
  const openAssistant = (area) => {
    byId('assistant-context').textContent = area;
    if (!dialog.open) dialog.showModal();
  };
  useEffect(() => {
    const update = () => {
      if (hash() === 'assistant-heading' || hash() === 'assistant') {
        history.replaceState(null, '', `#${pages.find(([key]) => key === document.body.dataset.workspace)?.[2] ?? 'dashboard-heading'}`);
        openAssistant(pages.find(([key]) => key === document.body.dataset.workspace)?.[1] ?? '종합 현황');
        return;
      }
      const next = viewForHash();
      if (dialog.open) dialog.close();
      document.body.dataset.workspace = next;
      setView(next);
      setAnchor(hash());
      const target = Object.hasOwn(aliases, hash()) ? byId(hash()) : null;
      if (target?.closest('#capacity-entry')) byId('capacity-entry').open = true;
      if (hash() === 'workflow-history') target.closest('details').open = true;
      requestAnimationFrame(() => target && !target.closest('[hidden]')
        ? target.scrollIntoView({ block: 'start' }) : window.scrollTo(0, 0));
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const [, title] = pages.find(([key]) => key === view);
  const sample = () => {
    const bid = bids[0];
    document.dispatchEvent(new CustomEvent('corevia:open-bid', { detail: {
      source: bid.source, summary: '5분 체험 · 모의 바이어 회신 포함', sample: true,
      context: { customer: bid.id, route: bid.route, selectedWeek: weeks[0].start, weeks },
    } }));
  };
  return <>
    {portal('workspace-nav', <>
      <a className="workspace-brand" href="#dashboard-heading"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Corevia</strong><small>약속계획</small></span></a>
      <nav aria-label="주 메뉴">
        {pages.map(([key, label, anchor, icon]) => <a key={key} href={`#${anchor}`} aria-current={view === key ? 'page' : undefined}>
          <span className="nav-icon" aria-hidden="true">{icon}</span>{label}</a>)}
      </nav>
    </>)}
    {portal('workspace-header', <div className="context-bar">
      <div><strong>{title}</strong><span>{experienceMode ? '5분 체험 · 이 탭에만 저장' : 'W05 · 입찰 검토'}</span></div>
      <div>
        {!experienceMode && workflow.record && <a href="?experience=1#dashboard-heading">5분 체험</a>}
        <button type="button" className="secondary" onClick={() => openAssistant(title)}>✦ 업무 어시스턴트</button>
      </div>
    </div>)}
    {portal('workflow-map', <WorkflowMap workflow={workflow} view={view} anchor={anchor} />)}
    {portal('experience-guide', experienceMode ? <div className="guide-strip">
      <div><strong>5분 체험</strong><p>{view === 'intake' ? '내부 자료와 모의 회신을 읽고 영업 검수 수락을 저장하세요.'
        : view === 'capacity' ? '확정 납품표를 불러와 계산하고 제품 행의 계산 근거를 확인하세요.'
          : view === 'proposal' ? '세 부서가 같은 버전을 수락한 뒤 참여 승인과 모의 제출을 기록하세요.'
            : '모의 자료로 시작해 계산 근거를 확인하고 승인까지 체험하세요.'}</p></div>
      <a href="?#dashboard-heading">일반 검토로 돌아가기</a>
    </div> : null)}
    {portal('start-options', !workflow.record && <div className="guide-strip">
      <div><strong>어떤 방식으로 시작하시겠어요?</strong><p>체험 기록은 이 탭에만 저장됩니다.</p></div>
      {experienceMode ? <a className="primary-link" href="#intake-request" onClick={sample}>모의 자료 불러오기</a>
        : <><a className="primary-link" href="?experience=1#dashboard-heading">예시 데이터로 5분 체험</a><a href="#intake-request">내 입찰 자료로 시작</a></>}
    </div>)}
    {portal('decision-overview', <DecisionOverview {...workflow} />)}
    {portal('trial-heading', <BidTrial />)}
    {portal('supply-overview', <SupplyOverview />)}
    {portal('customer-trends', <CustomerTrends />)}
    {portal('production-overview', <ProductionOverview plans={workflow.plans} />)}
    {portal('scenario-view', <ScenarioLab />)}
  </>;
}

function WorkflowMap({ workflow, view, anchor }) {
  const { record, plans, reviewed, approved, submitted, replied, next, href, outcome } = workflow;
  const steps = [
    ['접수·자료 확인', '#intake-request', record?.decision === 'accepted'],
    ['공급안 계산', '#capacity-entry', plans.length > 0],
    ['부서 검수', '#department-review', reviewed],
    ['참여 승인', '#proposal-workflow', approved],
    ['모의 제출·회신', '#proposal-document', replied],
  ];
  const destination = steps.findIndex(([, target]) => target === href
    || (target === '#intake-request' && href === '#review')
    || (target === '#proposal-document' && href === '#buyer-reply-form'));
  const destinationLabel = steps[destination]?.[0] ?? '다음 작업';
  const returnRequired = outcome === 'return';
  const showLink = href && outcome !== 'stop';
  const current = view === 'intake' ? 0 : view === 'capacity' ? 1
    : view === 'proposal' ? anchor === 'department-review' ? 2 : ['proposal-document', 'buyer-reply-form'].includes(anchor) ? 4 : 3 : -1;
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
      {view === 'scenario' ? <a href="#dashboard-heading">종합 현황으로 돌아가기 →</a>
        : showLink && <a href={href}>{returnRequired ? `${destinationLabel} 단계로 돌아가기 ↶` : `${destinationLabel} 열기 →`}</a>}</p>
  </nav>;
}

const portal = (id, content) => createPortal(content, byId(id));
createRoot(byId('workspace-root')).render(<Workspace />);
