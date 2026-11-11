import { modules } from '../public/assistant-skills.mjs';
import { explainCodes } from './gemini-safe.mjs';

import { selectAction } from '../public/ai-logic.mjs';

export async function assistWorkflow(request, response) {
  const send = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (!process.env.GEMINI_API_KEY) return send(503, { error: '.env.local에 GEMINI_API_KEY를 설정하고 서버를 다시 실행하세요.' });
  if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON 요청이 필요합니다.' });
  let input;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 32000) return send(413, { error: '질문과 업무 정보가 너무 깁니다.' });
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000
      || !input.context || typeof input.context !== 'object') throw new Error();
  } catch {
    return send(400, { error: '질문과 업무 정보를 확인하세요.' });
  }
  try {
    const { codes, action } = selectAction(input.message, input.context);
    const answer = await explainCodes(
      '입찰 업무 코드에 따라 한국어로 두 문장 이내로 안내하세요. 실제 날짜, 수량, 업체명은 알 수 없습니다. request_data는 담당자가 보낼 확인 요청 문구만 작성하세요. draft_change는 변경 후보 검수 안내, clarify_change는 대상 주차·품목·수량 확인 안내입니다. 승인·제출은 담당자가 수행합니다. 화면 이름은 ' + Object.values(modules).map(({ title }) => title).join(', ') + '입니다.',
      codes,
    );
    return send(200, { ...action, answer, ...(action.skill === 'draft_data_request' ? { detail: answer } : {}) });
  } catch (error) {
    return send(502, { error: /^Gemini 호출 실패 \(\d+\)$/.test(error.message) ? error.message : 'Gemini 응답을 확인하지 못했습니다.' });
  }
}
