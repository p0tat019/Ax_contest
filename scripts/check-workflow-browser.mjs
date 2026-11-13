import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

const deployed = process.env.COREVIA_TEST_URL;
const child = deployed ? null : spawn(process.execPath, ['scripts/dev-server.mjs'], { stdio: ['ignore', 'pipe', 'inherit'] });
let browser;

async function serverUrl() {
  if (deployed) return new URL(deployed).origin;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('개발 서버가 시작되지 않았습니다.')), 10000);
    child.stdout.on('data', (chunk) => {
      const url = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error('개발 서버 종료: ' + code));
    });
  });
}

async function verifyWorkflow(page, base) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let mailRequests = 0;
  await page.route('**/api/work-mail', (route) => {
    mailRequests++;
    return route.fulfill({ json: { accepted: true } });
  });
  const field = (id) => page.locator('#' + id);
  async function action(source) {
    const label = (await source.getAttribute('data-workflow-label')) ?? (await source.textContent()).trim();
    const dock = field('workflow-actions');
    let button = dock.getByRole('button', { name: label, exact: true });
    if (!await button.isVisible()) {
      await page.locator('#workflow-action-menu > summary').click();
      button = dock.getByRole('button', { name: label, exact: true });
    }
    const bounds = await dock.boundingBox();
    assert.ok(bounds && Math.abs(bounds.y + bounds.height - page.viewportSize().height) <= 2,
      '작업 버튼 영역은 화면 하단에 있어야 합니다.');
    await button.click();
  }
  const submit = (id) => action(page.locator('#' + id + ' button[type=submit]'));
  const fillExample = (name) => action(page.locator('[data-trial-fill="' + name + '"]'));
  const stored = (key) => page.evaluate((name) =>
    JSON.parse(sessionStorage.getItem('corevia.experience.hands-on.' + name + '.v1')), key);
  async function view(name) {
    await page.waitForFunction((expected) => {
      const visible = [...document.querySelectorAll('main > section[data-view]')]
        .filter((section) => section.getClientRects().length > 0);
      return document.body.dataset.workspace === expected && visible.length === 1
        && visible[0].dataset.view === expected;
    }, name);
    assert.deepEqual(await page.locator('main > section[data-view]:visible').evaluateAll((sections) =>
      sections.map((section) => section.dataset.view)), [name]);
  }
  async function open(hash, name) {
    await page.evaluate((anchor) => { location.hash = anchor; }, hash);
    await view(name);
  }
  async function decision(role, result, { feedback, closure, finance } = {}) {
    await field('department-role').selectOption(role);
    await field('department-person').fill(role + ' 담당');
    await field('department-decision').selectOption(result);
    if (feedback) await field('department-feedback').fill(feedback);
    if (closure) await field('department-closure-evidence').fill(closure);
    if (finance) {
      await field('department-finance-cost').fill('체험 증분원가 근거');
      await field('department-finance-cash').fill('체험 수금 조건 근거');
    }
    await submit('department-form');
  }
  async function approvalLink() {
    const [{ version }, scope] = await Promise.all([stored('department'), stored('work-mail-scope')]);
    const key = JSON.stringify([scope, 'approval/' + version, 'approver', 'approver@example.com']);
    const digest = await page.evaluate(async (value) => Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
      (byte) => byte.toString(16).padStart(2, '0')).join(''), key);
    return 'work-mail-' + digest;
  }

  await page.goto(base);
  await view('intake');
  assert.equal(await page.locator('[data-trial-fill]:visible').count(), 0);
  await page.getByRole('link', { name: '모의 입찰', exact: true }).click();
  await view('demo');
  assert.match(await field('dashboard-trial-start').innerText(), /예시 입찰 접수부터 직접 진행/);
  assert.match(await field('dashboard-followup-start').innerText(), /출고 변경과 재검수 과정 보기/);
  const entry = await field('workflow-actions').getByRole('button', { name: /예시 입찰 접수부터 직접 진행/ }).boundingBox();
  assert.ok(entry && entry.x >= 0 && entry.x + entry.width <= page.viewportSize().width);
  await action(field('dashboard-followup-start'));
  await page.locator('.trial-player[open]').waitFor();
  await page.getByRole('button', { name: '시연 닫기' }).click();
  await action(field('dashboard-trial-start'));
  await view('intake');
  await action(field('example'));
  await view('review');
  const condition = (label) => page.locator('#review-form').getByLabel(label, { exact: true });
  assert.equal(await condition('확정 납품표').inputValue(), '');
  await condition('납기 지연 페널티').fill('월 2%');
  await fillExample('sales');
  const supplied = {
    '확정 납품표': /PL-01 10000.*PL-02 6000/,
    '납품표 확인 근거': /SIM-BUYER-001/,
    '입찰 마감': /^2026-07-22$/,
    '초도 납품일': /^2026-08-02$/,
    '분할 납품 조건': /일괄 납품/,
    '결제 통화 및 조건': /USD.*30일/,
    '페널티 산정 기준과 한도': /10%/,
    '주간 실효능력': /194,000/,
    '기존 납품 약속 확인': /134,000/,
  };
  for (const [label, expected] of Object.entries(supplied)) assert.match(await condition(label).inputValue(), expected);
  assert.equal(await condition('납기 지연 페널티').inputValue(), '월 2%');
  assert.equal(await field('review-task-count').innerText(), '0건');
  await open('intake-request', 'intake');
  await action(page.locator('#hands-on-intake button'));
  await action(field('extract'));
  await view('review');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await fillExample('sales');
  await submit('review-form');
  await view('capacity');
  await fillExample('capacity');
  await submit('capacity-form');
  await view('calculation');
  assert.match(await field('capacity-decision-card').innerText(), /16,000 EA/);
  await open('proposal-workflow', 'proposal');
  assert.equal(await field('approval-form').isVisible(), false);

  await open('department-review', 'department');
  await fillExample('department');
  assert.equal(await field('department-role').inputValue(), '영업');
  await submit('department-form');
  await decision('생산관리', 'rejected', { feedback: '라인 전환 근거 확인 필요' });
  await open('proposal-workflow', 'proposal');
  assert.equal(await field('approval-form').isVisible(), false);
  await open('department-review', 'department');
  await fillExample('department');
  assert.notEqual(await field('department-closure-evidence').inputValue(), '');
  await submit('department-form');
  await fillExample('department');
  await submit('department-form');
  await view('proposal');

  await open('work-mail-panel', 'settings');
  await fillExample('roles');
  await submit('work-mail-settings');
  const oldLink = await approvalLink();
  await open(oldLink, 'task');
  await fillExample('task');
  assert.equal(await field('work-inbox-field-person').inputValue(), '체험 승인자');
  await submit('work-inbox-response');
  await view('submission');
  await action(field('proposal-submit'));
  await view('reply');
  await page.reload();
  await view('reply');
  assert.equal(await field('buyer-reply-form').isVisible(), true);

  await action(field('experience-buyer-change'));
  await submit('buyer-reply-form');
  await view('review');
  assert.ok(page.url().endsWith('#buyer-change-edit'));
  assert.equal((await stored('proposal'))?.approval, null);
  await open(oldLink, 'task');
  await page.getByRole('status').filter({ hasText: '현재 요청을 찾지 못했습니다' }).waitFor();
  assert.equal(await field('work-inbox-response').isVisible(), false);
  await open('buyer-change-edit', 'review');
  await fillExample('sales');
  assert.match(await condition('확정 납품표').inputValue(), /PL-01 1500.*PL-02 500/);
  assert.match(await condition('납품표 확인 근거').inputValue(), /SIM-BUYER-002/);
  await submit('review-form');
  await view('capacity');
  await open('work-inbox', 'inbox');
  await page.locator('#work-inbox-list button').filter({ hasText: '물류' }).first().click();
  await view('task');
  assert.equal(await field('work-inbox-response').isVisible(), true);
  await fillExample('task');
  await submit('work-inbox-response');
  await view('calculation');
  assert.match(await field('capacity-decision-card').innerText(), /2,000 EA/);
  await open('department-review', 'department');
  for (const role of ['영업', '생산관리', '재무·전략']) {
    await fillExample('department');
    assert.equal(await field('department-role').inputValue(), role);
    if (role === '재무·전략') assert.match(await field('department-finance-cost').inputValue(), /SIM-FIN/);
    await submit('department-form');
  }
  await view('proposal');
  const revisedLink = await approvalLink();
  assert.notEqual(revisedLink, oldLink);
  await open(revisedLink, 'task');
  assert.match(await field('work-inbox-request').innerText(), /2,000 EA/);
  await open('proposal-workflow', 'proposal');
  await fillExample('approval');
  await submit('approval-form');
  await view('submission');
  assert.match(await field('proposal-content').innerText(), /1,500 EA/);
  assert.match(await field('proposal-content').innerText(), /500 EA/);
  await action(field('proposal-submit'));
  await view('reply');
  await fillExample('reply');
  await submit('buyer-reply-form');
  assert.match(await field('buyer-reply-status').innerText(), /바이어 접수 확인/);
  assert.equal(await field('buyer-reply-form').isVisible(), false);

  await open('trial-heading', 'scenario');
  const seed = page.getByLabel('재현 번호');
  await seed.fill('4294967296');
  const replay = page.locator('#trial-heading button[type=submit][data-workflow-action]');
  await action(replay);
  await page.getByRole('alert').filter({ hasText: '4294967295' }).waitFor();
  await seed.fill('42');
  await action(replay);
  await page.getByRole('button', { name: '결과 바로 보기' }).click();
  const result = page.locator('.trial-results tbody');
  const first = await result.innerText();
  assert.match(await page.locator('.trial-results').innerText(), /원본 재현 번호 42/);
  await action(replay);
  await page.getByRole('button', { name: '결과 바로 보기' }).click();
  assert.equal(await result.innerText(), first);

  await page.setViewportSize({ width: 390, height: 844 });
  await open('work-mail-panel', 'settings');
  assert.equal(await field('work-mail-key').isVisible(), false);
  assert.equal(await page.locator('[name=approver-email]').inputValue(), 'approver@example.com');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  assert.equal(mailRequests, 0);
  assert.deepEqual(errors, []);
  console.log('PASS 사용자 흐름 · 16,000→2,000 EA · 반려/보완 · 이전 링크 만료 · 재승인 · 난수 재현 · 모바일');
}

try {
  const base = await serverUrl();
  const requested = process.env.COREVIA_BROWSER;
  const channel = requested === 'chromium' ? undefined : requested || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({ channel });
  for (const width of [1200, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(9000);
    await verifyWorkflow(page, base);
    await page.close();
    console.log('PASS 화면 폭 ' + width + 'px');
  }
} finally {
  await browser?.close();
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
