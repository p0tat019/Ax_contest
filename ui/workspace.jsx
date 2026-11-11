import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import { SupplyOverview } from './supply-overview.jsx';

const pages = [
  ['dashboard', '업무 개요', 'dashboard-heading', '▤', '기존 공급 약속을 먼저 확인하고 새 입찰의 공급 여력을 검토하세요.'],
  ['intake', '입찰 접수', 'intake-request', '▣', '요청서와 바이어 회신을 확인해 공급 조건을 정리합니다.'],
  ['capacity', '생산계획', 'capacity', '▥', '기존 약속을 지키면서 제안할 수 있는 물량을 계산합니다.'],
  ['review', '부서 검수', 'department-review', '✓', '같은 공급안에 대한 부서별 결정과 수정 근거를 기록합니다.'],
  ['proposal', '승인·제출', 'proposal-workflow', '↗', '확인된 조건과 근거를 보고 입찰 참여를 결정합니다.'],
  ['assistant', 'Gemini 어시스턴트', 'assistant-heading', '✦', '막힌 이유를 확인하고 자료 요청이나 수정 초안을 작성합니다.'],
];
const aliases = { review: 'intake', result: 'intake', 'capacity-result': 'capacity', 'approval-evidence': 'proposal' };
const byId = (id) => document.getElementById(id);
const currentView = () => {
  const hash = window.location.hash.slice(1);
  return pages.find(([key, , anchor]) => key === hash || anchor === hash)?.[0] ?? aliases[hash] ?? 'dashboard';
};

function useWorkspaceView() {
  const [view, setView] = useState(currentView);
  useEffect(() => {
    const update = () => setView(currentView());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return view;
}

function useWorkflowSummary() {
  const snapshot = () => {
    const steps = [...byId('workflow-steps').children].map((item) => item.textContent);
    const tasks = byId('result').hidden ? null : [...byId('tasks').children].filter((item) => item.querySelector('details')).length;
    return { steps, tasks, next: byId('workflow-next-link').getAttribute('href') };
  };
  const [summary, setSummary] = useState(snapshot);
  useEffect(() => {
    const observer = new MutationObserver(() => setSummary(snapshot()));
    for (const id of ['workflow-steps', 'workflow-next-link', 'tasks', 'result']) {
      observer.observe(byId(id), { childList: true, subtree: true, attributes: true });
    }
    setSummary(snapshot());
    return () => observer.disconnect();
  }, []);
  return summary;
}

function Navigation() {
  const view = useWorkspaceView();
  return <>
    <a className="workspace-brand" href="#dashboard-heading">
      <span className="brand-mark" aria-hidden="true">C</span>
      <span><strong>Corevia</strong><small>약속계획</small></span>
    </a>
    <nav aria-label="주 메뉴">
      {pages.map(([key, title, anchor, icon]) =>
        <a key={key} href={`#${anchor}`} aria-current={key === view ? 'page' : undefined}>
          <span className="nav-icon" aria-hidden="true">{icon}</span>{title}
        </a>)}
    </nav>
  </>;
}

function Header() {
  const view = useWorkspaceView();
  const [, title, , , description] = pages.find(([key]) => key === view);
  useEffect(() => {
    document.body.dataset.workspace = view;
    if (window.location.hash) {
      const hash = window.location.hash.slice(1);
      const target = Object.hasOwn(aliases, hash) ? byId(hash) : null;
      if (target && !target.closest('[hidden]')) target.scrollIntoView({ block: 'start' });
      else window.scrollTo(0, 0);
    }
  }, [view]);
  return <div className="page-header">
    <div>
      <Badge label="W05 · 입찰 검토" variant="neutral" />
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    {view !== 'assistant' && <Button label="Gemini에게 물어보기" variant="secondary" href="#assistant-heading" />}
  </div>;
}

function Metrics() {
  const { steps, tasks } = useWorkflowSummary();
  const details = (index, fallback) => steps[index]?.split(' · ').slice(1).join(' · ') || fallback;
  return <div className="metric-grid">
    {[
      ['접수 검수', details(0, '대기'), '입찰 조건'],
      ['미해결 작업', tasks === null ? '—' : `${tasks}건`, '회신 확인'],
      ['공급안', details(1, '계산 대기'), '생산계획'],
      ['부서 검수', details(2, '0/3 수락'), '승인 전 검수'],
    ].map(([label, value, description]) => <div className="metric" key={label}>
      <span>{label}</span><strong>{value}</strong><small>{description}</small>
    </div>)}
  </div>;
}

for (const [id, Component] of [['workspace-nav', Navigation], ['workspace-header', Header], ['workspace-metrics', Metrics], ['supply-overview', SupplyOverview]]) {
  createRoot(byId(id)).render(<Theme theme={neutralTheme}><Component /></Theme>);
}
