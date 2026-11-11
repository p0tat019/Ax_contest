import { modules } from '../public/assistant-skills.mjs';

export const assistantPrompt = '입찰 업무 코드에 따라 한국어로 두 문장 이내로 안내하세요. 실제 날짜, 수량, 업체명은 알 수 없습니다. request_data는 담당자가 보낼 확인 요청 문구만 작성하세요. draft_change는 변경 후보 검수 안내, clarify_change는 대상 주차·품목·수량 확인 안내입니다. 승인·제출은 담당자가 수행합니다. 화면 이름은 ' + Object.values(modules).map(({ title }) => title).join(', ') + '입니다.';
export const feedbackPrompt = '한국어로 한 문장으로 안내하세요. draft_change이면 담당자가 변경값과 원문을 확인한 뒤 적용하라고 안내하세요. clarify_change이면 대상 주차와 품목, 변경 후 수량을 확인하라고 안내하세요. 회사명, 실제 수량과 날짜를 생성하지 마세요.';
