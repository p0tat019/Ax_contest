function base64(value) {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes));
}

const encodedPart = (value) => base64(value).match(/.{1,76}/g).join('\r\n');

export async function sendGmailWorkMail(env, { to, subject, text, html, task }) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID.trim(),
      client_secret: env.GOOGLE_CLIENT_SECRET.trim(),
      refresh_token: env.GOOGLE_REFRESH_TOKEN.trim(),
      grant_type: 'refresh_token',
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(6000),
  });
  const token = await tokenResponse.json().catch(() => null);
  if (!tokenResponse.ok || typeof token?.access_token !== 'string' || !token.access_token) {
    throw new Error('Gmail 발송 권한을 확인하세요. 동일한 OAuth 클라이언트의 설정과 Gmail 발송 권한이 필요합니다.');
  }
  const sender = env.GMAIL_SENDER.trim();
  const boundary = `corevia_${task.slice(0, 24)}`;
  const mime = [
    `From: Corevia <${sender}>`, `To: ${to}`, `Subject: =?UTF-8?B?${base64(subject)}?=`,
    `Message-ID: <corevia-${task}@${sender.split('@')[1]}>`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedPart(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedPart(html),
    `--${boundary}--`, '',
  ].join('\r\n');
  const raw = base64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
      redirect: 'error',
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) return 'accepted';
    if (response.status < 500) return 'rejected';
  } catch {
    // A network failure after submission can still leave a message in Sent.
  }
  return 'unknown';
}
