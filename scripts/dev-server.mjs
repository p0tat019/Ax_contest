import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const page = new URL('../public/index.html', import.meta.url);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1:3000').pathname;
  if (pathname !== '/' && pathname !== '/index.html') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  try {
    const html = await readFile(page);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
  } catch (error) {
    console.error(error);
    response.writeHead(500);
    response.end('Unable to load page');
  }
});

server.listen(3000, '127.0.0.1', () => {
  console.log('Corevia 약속계획 http://127.0.0.1:3000');
});
