import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { loadState } from '../public/workflow-storage.mjs';
import { CustomerTrends, DecisionOverview, ProductionOverview, ScenarioLab } from './decision-views.jsx';
import { SupplyOverview } from './supply-overview.jsx';
import './workspace.css';

const pages = [
  ['dashboard', '종합 현황', 'dashboard-heading', '◫'],
  ['intake', '고객·계약', 'customer-history', '▤'],
  ['capacity', '생산계획', 'capacity', '▥'],
  ['scenario', '시나리오 분석', 'scenario-heading', '◈'],
  ['proposal', '검수·승인', 'proposal-workflow', '✓'],
];
const aliases = { review: 'intake', result: 'intake', 'intake-request': 'intake', 'capacity-result': 'capacity', 'capacity-entry': 'capacity',
  'department-review': 'proposal', 'approval-evidence': 'proposal', 'workflow-history': 'proposal' };
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
      decision: loadState('proposal')?.approval?.decision,
      next: byId('workflow-next').textContent, href: byId('workflow-next-link').getAttribute('href'),
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
  return <>
    {portal('workspace-nav', <>
      <a className="workspace-brand" href="#dashboard-heading"><span className="brand-mark" aria-hidden="true">C</span><span><strong>Corevia</strong><small>약속계획</small></span></a>
      <nav aria-label="주 메뉴">
        {pages.map(([key, label, anchor, icon]) => <a key={key} href={`#${anchor}`} aria-current={view === key ? 'page' : undefined}>
          <span className="nav-icon" aria-hidden="true">{icon}</span>{label}</a>)}
      </nav>
    </>)}
    {portal('workspace-header', <div className="context-bar">
      <div><strong>{title}</strong><span>W05 · 시연 환경</span></div>
      <button type="button" className="secondary" onClick={() => openAssistant(title)}>✦ 업무 어시스턴트</button>
    </div>)}
    {portal('decision-overview', <DecisionOverview {...workflow} />)}
    {portal('supply-overview', <SupplyOverview />)}
    {portal('customer-trends', <CustomerTrends />)}
    {portal('production-overview', <ProductionOverview plans={workflow.plans} />)}
    {portal('scenario-view', <ScenarioLab />)}
  </>;
}

const portal = (id, content) => createPortal(content, byId(id));
createRoot(byId('workspace-root')).render(<Workspace />);
