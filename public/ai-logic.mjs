const dataTopics = [
  [/초도|첫\s*납품/, 'first_delivery', '영업', '초도 납품일 확인'],
  [/분할/, 'split_delivery', '영업', '분할 납품 조건 확인'],
  [/마감|제출\s*기한/, 'deadline', '영업', '입찰 마감일 확인'],
  [/기존.*(?:주문|납품)|잔여\s*의무/, 'existing_orders', '영업', '기존 납품 약속 확인'],
  [/가용량|생산능력|실효능력/, 'weekly_capacity', '생산관리', '주간 가용량 확인'],
  [/결제|수금|지급/, 'payment', '재무·전략', '결제 및 수금 조건 확인'],
  [/페널티|위약/, 'penalty', '영업', '지연 페널티 조건 확인'],
];

export function selectAction(message, context) {
  const screen = context.screen ?? {};
  const module = /승인|제출|제안서/.test(message) ? 'proposal'
    : /부서|반려|검수/.test(message) ? 'review'
      : /생산|가용량|계산/.test(message) ? 'capacity'
        : /접수|RFP/i.test(message) ? 'intake'
          : ['dashboard', 'intake', 'capacity', 'review', 'proposal'].includes(context.activeModule) ? context.activeModule : 'dashboard';
  if (/(?:수정|변경|정정|초안)/.test(message) && Array.isArray(context.rows)) {
    const candidates = context.rows.slice(0, 40).flatMap((row, index) => {
      const product = typeof row?.line === 'string' ? row.line.match(/\bPL-\d{2}\b/)?.[0] : null;
      const change = findQuantityChange(message, { product, week: row?.week, capacity: row?.capacity });
      return change ? [{ ...change, index }] : [];
    });
    if (candidates.length === 1) {
      const change = candidates[0];
      return { codes: ['draft_change', 'capacity'], action: { skill: 'draft_edit', module: 'capacity',
        field: change.field, row: change.index, value: String(change.value) } };
    }
    if (candidates.length > 1 || /\d+\s*(?:EA|개)/i.test(message)) {
      return { codes: ['clarify_change', 'capacity'], action: { skill: 'explain_workflow', module: 'capacity' } };
    }
  }
  const topic = dataTopics.find(([pattern]) => pattern.test(message));
  if (topic && /요청|조회|가져|찾아|확인.*(?:줘|주세요)/.test(message)) {
    const [, code, owner, subject] = topic;
    return { codes: ['request_data', code], action: { skill: 'draft_data_request', owner, subject } };
  }
  if (/열어|이동|보여/.test(message)) return { codes: ['navigate', module], action: { skill: 'open_module', module } };
  const proposal = Array.isArray(screen.proposal) ? screen.proposal.join(' ') : '';
  const status = /수정안을 다시 계산/.test(proposal) ? 'recalculate'
    : /납품 부족을 해소/.test(proposal) ? 'existing_shortage'
      : /모의 제출 완료|바이어 접수 확인/.test(proposal) ? 'submitted'
        : /입찰 결정 대기/.test(proposal) ? 'approval_waiting'
          : /검수 수락이 필요/.test(proposal) ? 'department_review'
            : screen.capacity?.length > 1 ? 'calculation_ready'
              : screen.intake?.length ? 'intake_reviewed' : 'not_started';
  return { codes: ['explain', module, status], action: { skill: 'explain_workflow', module } };
}

export function findQuantityChange(message, row) {
  if (typeof message !== 'string' || !row) return null;
  const products = message.match(/\bPL-\d{2}\b/gi) ?? [];
  const dates = message.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  if (products.some((product) => product.toUpperCase() !== row.product)
    || dates.some((date) => date !== row.week)) return null;
  const matches = [...message.matchAll(/(가용량\s*감소|추가\s*확정\s*주문|신규\s*요청량?)\s*(?:을|를|은|는|:)?\s*([\d,]+)\s*(?:EA|개)\s*(?:로|으로)?/gi)];
  const quantities = message.match(/[\d,]+\s*(?:EA|개)/gi) ?? [];
  if (matches.length !== 1 || quantities.length !== 1
    || /(?:미확정|검토\s*중|\?|~|아니|말고|에서|이상|이하|만큼)/.test(message)) return null;
  const [quote, label, amount] = matches[0];
  const field = label.startsWith('가용량') ? 'reduction' : label.startsWith('추가') ? 'additional' : 'requested';
  const value = Number(amount.replaceAll(',', ''));
  if (!Number.isSafeInteger(value) || value < 0
    || (field === 'reduction' && (!Number.isSafeInteger(row.capacity) || value > row.capacity))) return null;
  return { field, value, quote };
}
