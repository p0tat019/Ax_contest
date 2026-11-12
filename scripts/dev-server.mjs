import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { analyzeFeedback } from './gemini-feedback.mjs';
import { assistWorkflow } from './gemini-assistant.mjs';
import { sendWorkMail } from '../worker/work-mail.mjs';

const localMailLimit = (maximum) => {
  let windowStart = 0;
  let count = 0;
  return { limit() {
    const now = Date.now();
    if (now - windowStart >= 60000) {
      windowStart = now;
      count = 0;
    }
    return { success: ++count <= maximum };
  } };
};
const mailEnv = { ...process.env, CLIENT_LIMIT: localMailLimit(12), SHARED_LIMIT: localMailLimit(12) };

async function sendLocalMail(request, response, origin) {
  const json = 'application/json; charset=utf-8';
  if (request.headers.origin !== origin || request.headers.host !== new URL(origin).host
    || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    response.writeHead(403, { 'Content-Type': json });
    response.end(JSON.stringify({ error: '로컬 앱 화면에서 발송을 요청하세요.' }));
    return;
  }
  const input = new Request(`${origin}/api/work-mail`, {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '127.0.0.1', 'X-Corevia-Mail-Key': request.headers['x-corevia-mail-key'] ?? '' },
    body: Readable.toWeb(request), duplex: 'half',
  });
  const result = await sendWorkMail(input, mailEnv, origin, { 'Content-Type': json, 'Cache-Control': 'no-store' });
  response.writeHead(result.status, Object.fromEntries(result.headers));
  response.end(await result.text());
}

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/index.html', ['index.html', 'text/html']],
  ['/workspace.js', ['workspace.js', 'text/javascript']],
  ['/workspace.css', ['workspace.css', 'text/css']],
  ['/intake.css', ['intake.css', 'text/css']],
  ['/intake.mjs', ['intake.mjs', 'text/javascript']],
  ['/intake-rules.mjs', ['intake-rules.mjs', 'text/javascript']],
  ['/intake-lookup.mjs', ['intake-lookup.mjs', 'text/javascript']],
  ['/intake-data.json', ['intake-data.json', 'application/json']],
  ['/capacity.mjs', ['capacity.mjs', 'text/javascript']],
  ['/capacity-plan.mjs', ['capacity-plan.mjs', 'text/javascript']],
  ['/capacity-allocation.mjs', ['capacity-allocation.mjs', 'text/javascript']],
  ['/capacity-verification.mjs', ['capacity-verification.mjs', 'text/javascript']],
  ['/supply-decision-view.mjs', ['supply-decision-view.mjs', 'text/javascript']],
  ['/capacity-scenarios.mjs', ['capacity-scenarios.mjs', 'text/javascript']],
  ['/department-review.mjs', ['department-review.mjs', 'text/javascript']],
  ['/proposal-workflow.mjs', ['proposal-workflow.mjs', 'text/javascript']],
  ['/proposal-checks.mjs', ['proposal-checks.mjs', 'text/javascript']],
  ['/workflow-storage.mjs', ['workflow-storage.mjs', 'text/javascript']],
  ['/work-inbox.mjs', ['work-inbox.mjs', 'text/javascript']],
  ['/work-mail.mjs', ['work-mail.mjs', 'text/javascript']],
  ['/work-mail-routes.mjs', ['work-mail-routes.mjs', 'text/javascript']],
  ['/assistant.mjs', ['assistant.mjs', 'text/javascript']],
  ['/assistant-skills.mjs', ['assistant-skills.mjs', 'text/javascript']],
  ['/ai-client.mjs', ['ai-client.mjs', 'text/javascript']],
  ['/ai-logic.mjs', ['ai-logic.mjs', 'text/javascript']],
  ['/ai-config.mjs', ['ai-config.mjs', 'text/javascript']],
]);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1:3000').pathname;
  if (pathname === '/api/assistant' && request.method === 'POST') {
    await assistWorkflow(request, response);
    return;
  }
  if (pathname === '/api/feedback' && request.method === 'POST') {
    await analyzeFeedback(request, response);
    return;
  }
  if (pathname === '/api/work-mail' && request.method === 'POST') {
    await sendLocalMail(request, response, `http://127.0.0.1:${server.address().port}`);
    return;
  }
  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  try {
    const [filename, type] = asset;
    const content = await readFile(new URL(`../public/${filename}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
    response.end(content);
  } catch (error) {
    console.error(error);
    response.writeHead(500);
    response.end('Unable to load page');
  }
});

const host = '127.0.0.1';
let port = 3000;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port === 3000) {
    console.log('3000번 포트가 사용 중입니다. 사용 가능한 포트로 시작합니다.');
    port = 0;
    server.listen(port, host);
    return;
  }
  console.error(`개발 서버를 시작하지 못했습니다. ${error.message}`);
  process.exitCode = 1;
});

server.on('listening', () => {
  console.log(`Corevia 약속계획 http://${host}:${server.address().port}`);
});

server.listen(port, host);
