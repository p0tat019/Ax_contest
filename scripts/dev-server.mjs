import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { analyzeFeedback } from './gemini-feedback.mjs';
import { assistWorkflow } from './gemini-assistant.mjs';

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
  ['/capacity-scenarios.mjs', ['capacity-scenarios.mjs', 'text/javascript']],
  ['/department-review.mjs', ['department-review.mjs', 'text/javascript']],
  ['/proposal-workflow.mjs', ['proposal-workflow.mjs', 'text/javascript']],
  ['/proposal-checks.mjs', ['proposal-checks.mjs', 'text/javascript']],
  ['/workflow-storage.mjs', ['workflow-storage.mjs', 'text/javascript']],
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
