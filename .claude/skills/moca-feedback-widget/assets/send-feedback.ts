/**
 * Netlify Function: send-feedback (solo email).
 *
 * Portata dal Moca Central Hub e resa self-contained: non usa Supabase né
 * autenticazione, così può essere copiata identica in ogni app satellite.
 * Riceve il feedback dal widget e lo inoltra via Resend al team.
 *
 * Variabili d'ambiente (da configurare su Netlify):
 *   - RESEND_API_KEY   (obbligatoria) chiave API Resend
 *   - FEEDBACK_TO_EMAIL   (facoltativa) destinatari separati da virgola
 *   - FEEDBACK_FROM_EMAIL (facoltativa) mittente verificato su Resend
 *   - FEEDBACK_APP_NAME   (facoltativa) nome app mostrato nell'email
 */

interface Screenshot {
  name: string;
  dataUrl: string;
}

interface FeedbackRequest {
  type: 'bug' | 'suggestion' | 'question' | 'other';
  severity?: 'low' | 'medium' | 'high' | 'blocker';
  title?: string;
  message: string;
  page?: string;
  contact_email?: string;
  page_url?: string;
  user_agent?: string;
  screenshots?: Screenshot[];
}

const TYPE_LABELS: Record<string, string> = {
  bug: 'Problema',
  suggestion: 'Suggerimento',
  question: 'Domanda',
  other: 'Altro',
};

const SEVERITY_LABELS: Record<string, string> = {
  low: 'Bassa',
  medium: 'Media',
  high: 'Alta',
  blocker: 'Bloccante',
};

// Nome dell'app mostrato nell'oggetto dell'email (override via env).
const APP_NAME = process.env.FEEDBACK_APP_NAME || 'Nome App' /* TODO: metti il nome di questa app */;

// Elenco destinatari separati da virgola. Default: entrambi i referenti.
const FEEDBACK_TO = (process.env.FEEDBACK_TO_EMAIL || 'daniele.pisciottano@mocainteractive.com,luigi.iacono@mocainteractive.com')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

const FEEDBACK_FROM = process.env.FEEDBACK_FROM_EMAIL || 'Moca Hub <onboarding@resend.dev>';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converte un data URL (data:image/png;base64,xxxx) in un allegato Resend.
 * Restituisce null se il valore non è un data URL base64 valido.
 */
function dataUrlToAttachment(name: string, dataUrl: string, index: number): { filename: string; content: string } | null {
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const ext = match[1].split('/')[1].replace('+xml', '').replace('jpeg', 'jpg');
  const safeBase = (name || `screenshot-${index + 1}`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = /\.[a-zA-Z0-9]+$/.test(safeBase) ? safeBase : `${safeBase}.${ext}`;
  return { filename, content: match[2] };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const handler = async (event: { httpMethod: string; body?: string | null }) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: JSON_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body: FeedbackRequest = JSON.parse(event.body || '{}');
    if (!body.message || !body.message.trim()) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Il messaggio è obbligatorio' }) };
    }
    if (!body.contact_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contact_email.trim())) {
      return { statusCode: 400, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Email per il ricontatto obbligatoria e valida' }) };
    }

    const type = ['bug', 'suggestion', 'question', 'other'].includes(body.type) ? body.type : 'other';
    const screenshots = Array.isArray(body.screenshots) ? body.screenshots.slice(0, 6) : [];

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.error('RESEND_API_KEY non configurata — impossibile inviare il feedback.');
      return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Invio email non configurato sul server' }) };
    }

    const severityLine = type === 'bug' && body.severity
      ? `<p><strong>Gravità:</strong> ${escapeHtml(SEVERITY_LABELS[body.severity] || body.severity)}</p>`
      : '';

    const html = `
      <div style="font-family: Arial, sans-serif; color: #1a1a1a; line-height: 1.5;">
        <h2 style="color:#E52217; margin-bottom: 4px;">Nuovo feedback — ${escapeHtml(TYPE_LABELS[type] || type)}</h2>
        <p style="color:#888;font-size:12px;margin-top:0;">App: <strong>${escapeHtml(APP_NAME)}</strong></p>
        ${body.title ? `<h3 style="margin:8px 0;">${escapeHtml(body.title)}</h3>` : ''}
        ${severityLine}
        <p style="white-space: pre-wrap; background:#f5f5f5; padding:12px; border-radius:8px;">${escapeHtml(body.message)}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0;" />
        ${body.contact_email ? `<p><strong>Email per ricontatto:</strong> ${escapeHtml(body.contact_email)}</p>` : ''}
        ${body.page ? `<p><strong>Pagina/sezione:</strong> ${escapeHtml(body.page)}</p>` : ''}
        ${body.page_url ? `<p><strong>URL:</strong> ${escapeHtml(body.page_url)}</p>` : ''}
        ${body.user_agent ? `<p style="color:#888;font-size:12px;"><strong>User agent:</strong> ${escapeHtml(body.user_agent)}</p>` : ''}
        ${screenshots.length ? `<p style="color:#888;font-size:12px;">${screenshots.length} screenshot in allegato</p>` : ''}
      </div>`;

    const attachments = screenshots
      .map((s, i) => dataUrlToAttachment(s.name, s.dataUrl, i))
      .filter((a): a is { filename: string; content: string } => a !== null);

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FEEDBACK_FROM,
        to: FEEDBACK_TO,
        reply_to: body.contact_email || undefined,
        subject: `[${APP_NAME} · ${TYPE_LABELS[type] || type}] ${body.title || body.message.slice(0, 60)}`,
        html,
        ...(attachments.length ? { attachments } : {}),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Resend email failed', resp.status, errText);
      return { statusCode: 502, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Impossibile inviare il feedback' }) };
    }

    return { statusCode: 200, headers: JSON_HEADERS, body: JSON.stringify({ success: true, email_sent: true }) };
  } catch (error: any) {
    console.error('Unexpected error in send-feedback', error?.message);
    return { statusCode: 500, headers: JSON_HEADERS, body: JSON.stringify({ error: 'Errore interno del server' }) };
  }
};
