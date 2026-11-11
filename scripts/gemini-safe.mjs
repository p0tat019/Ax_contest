const codes = new Set([
  'intake', 'capacity', 'review', 'proposal', 'dashboard',
  'not_started', 'intake_reviewed', 'calculation_ready', 'existing_shortage',
  'department_review', 'approval_waiting', 'submitted', 'recalculate',
  'explain', 'navigate', 'draft_change', 'clarify_change', 'request_data',
  'first_delivery', 'split_delivery', 'deadline', 'existing_orders', 'weekly_capacity', 'payment', 'penalty', 'unspecified',
]);

export async function explainCodes(instructions, values, env = process.env) {
  if (!values.every((value) => codes.has(value))) throw new Error('Unexpected workflow code');
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const result = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(25000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ parts: [{ text: JSON.stringify(values) }] }],
      generationConfig: { maxOutputTokens: 1024 },
    }),
  });
  if (!result.ok) throw new Error(`Gemini 호출 실패 (${result.status})`);
  const payload = await result.json();
  const answer = payload.candidates?.[0]?.content?.parts?.filter((part) => !part.thought)
    .map((part) => part.text).join('').trim();
  if (!answer) throw new Error('Gemini 응답이 비어 있습니다.');
  return answer.slice(0, 3000);
}
