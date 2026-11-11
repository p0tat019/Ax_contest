import { explainCodes } from './gemini-safe.mjs';
import { findQuantityChange } from '../public/ai-logic.mjs';

export async function analyzeFeedback(request, response) {
  const send = (status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  if (!process.env.GEMINI_API_KEY) return send(503, { error: '서버에 GEMINI_API_KEY를 설정한 뒤 다시 실행하세요.' });
  if (!request.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON 요청이 필요합니다.' });
  let input;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 16000) return send(413, { error: '회신이 너무 깁니다.' });
      chunks.push(chunk);
    }
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof input.feedback !== 'string' || !input.feedback.trim() || !input.row) throw new Error();
  } catch {
    return send(400, { error: '회신과 대상 행을 확인하세요.' });
  }
  try {
    const candidate = findQuantityChange(input.feedback, input.row);
    const reason = await explainCodes(
      '한국어로 한 문장으로 안내하세요. draft_change이면 담당자가 변경값과 원문을 확인한 뒤 적용하라고 안내하세요. clarify_change이면 대상 주차와 품목, 변경 후 수량을 확인하라고 안내하세요. 회사명, 실제 수량과 날짜를 생성하지 마세요.',
      [candidate ? 'draft_change' : 'clarify_change', 'capacity'],
    );
    return send(200, { ...(candidate ?? { field: 'none' }), reason });
  } catch (error) {
    return send(502, { error: /^Gemini 호출 실패 \(\d+\)$/.test(error.message) ? error.message : 'Gemini 응답을 확인하지 못했습니다.' });
  }
}
