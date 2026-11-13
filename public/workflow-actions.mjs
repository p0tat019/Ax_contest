const dock = document.getElementById('workflow-actions');
const primary = document.getElementById('workflow-action-buttons');
const extra = document.getElementById('workflow-action-extra');
const menu = document.getElementById('workflow-action-menu');
const page = document.querySelector('main');
let rendered = [];

function available(source, view) {
  if (source.dataset.workflowAction === 'fallback') {
    const target = document.getElementById(source.hash.slice(1))?.closest('section[data-view]');
    return target && target.dataset.view !== view;
  }
  const section = source.closest('section[data-view]');
  return section?.dataset.view === view && !source.closest('[hidden], details:not([open])');
}

function render() {
  const view = document.body.dataset.workspace;
  const actions = [...page.querySelectorAll('[data-workflow-action]')].filter((source) => available(source, view));
  const state = actions.map((source) => ({
    source, label: source.dataset.workflowLabel ?? source.textContent.trim(), kind: source.dataset.workflowAction, disabled: source.disabled === true,
  }));
  if (state.length === rendered.length && state.every((item, index) =>
    Object.keys(item).every((key) => item[key] === rendered[index][key]))) return;
  const focused = document.activeElement?.dataset.actionIndex;
  const last = focused === undefined ? null : rendered[Number(focused)]?.source;
  rendered = state;
  const buttons = state.map(({ source, label, kind, disabled }, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = kind === 'primary' ? 'workflow-action-primary' : 'secondary';
    button.textContent = label;
    button.disabled = disabled;
    button.dataset.actionIndex = index;
    if (source.hasAttribute('aria-haspopup')) button.setAttribute('aria-haspopup', source.getAttribute('aria-haspopup'));
    button.addEventListener('click', () => {
      if (!available(source, document.body.dataset.workspace) || source.disabled) return;
      if (menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
      source.click();
    });
    return button;
  });
  const primaryIndex = state.findIndex(({ kind }) => kind === 'primary');
  const lead = primaryIndex < 0 ? state.findIndex(({ kind }) => kind === 'fallback') : primaryIndex;
  const example = state.findLastIndex(({ kind }) => kind === 'example');
  const featured = [example, lead].filter((index) => index >= 0);
  primary.replaceChildren(...featured.map((index) => buttons[index]));
  extra.replaceChildren(...buttons.filter((_, index) => !featured.includes(index) && state[index].kind !== 'fallback'));
  menu.hidden = extra.childElementCount === 0;
  if (menu.hidden) menu.open = false;
  dock.hidden = primary.childElementCount + extra.childElementCount === 0;
  page.toggleAttribute('data-fixed-actions', !dock.hidden);
  if (last) {
    const index = state.findIndex(({ source }) => source === last);
    if (index >= 0 && buttons[index].getClientRects().length) buttons[index].focus();
  }
}

const observer = new MutationObserver(render);
observer.observe(page, { subtree: true, childList: true, characterData: true,
  attributes: true, attributeFilter: ['hidden', 'disabled', 'open', 'href', 'data-workflow-action'] });
observer.observe(document.body, { attributes: true, attributeFilter: ['data-workspace'] });
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--workflow-action-height', dock.offsetHeight + 'px');
}).observe(dock);
document.body.classList.add('workflow-actions-ready');
render();
