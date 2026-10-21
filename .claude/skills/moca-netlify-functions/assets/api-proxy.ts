import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

/**
 * Esempio di Netlify Function per un'app integrata Moca Hub.
 *
 * Pattern conforme all'Hub:
 *  1. Gestione CORS (preflight OPTIONS + origin allow-list).
 *  2. Verifica del JWT utente via Supabase (auth.getUser).
 *  3. Autorizzazione sul client_id (l'utente deve essere assegnato al cliente).
 *  4. Logica server-side con segreti/service-role MAI esposti al browser.
 *
 * Usa questo pattern per: proxy verso API di terzi, operazioni privilegiate,
 * scraping, job che devono scavalcare la RLS.
 */

// Origin consentiti (aggiungi qui la URL di produzione/staging dell'app).
const ALLOWED_ORIGINS = [
  'https://moca-central-hub.netlify.app',
  'http://localhost:5173',
  'http://localhost:4173',
];

function corsHeaders(origin?: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

// Client admin: service_role key, bypassa la RLS. SOLO server-side.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const handler: Handler = async (event: HandlerEvent, _ctx: HandlerContext) => {
  const headers = corsHeaders(event.headers.origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // 1. Autenticazione: verifica il JWT utente.
    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Autenticazione richiesta' }) };
    }
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
    if (authErr || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token non valido' }) };
    }

    const { client_id, payload } = JSON.parse(event.body ?? '{}');
    if (!client_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'client_id richiesto' }) };
    }

    // 2. Autorizzazione: l'utente è assegnato a questo cliente?
    const { data: userRow } = await supabaseAdmin
      .from('users').select('id, role').eq('id', user.id).single();

    const privileged = userRow?.role === 'super_admin' || userRow?.role === 'manager';
    if (!privileged) {
      const { data: assigned } = await supabaseAdmin
        .from('user_clients').select('client_id').eq('user_id', user.id);
      const ok = (assigned ?? []).some((a) => a.client_id === client_id);
      if (!ok) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Accesso negato a questo cliente' }) };
      }
    }

    // 3. Recupera la API key del cliente lato server (mai dal browser).
    const { data: cfg } = await supabaseAdmin
      .from('configurations')
      .select('config_value')
      .eq('client_id', client_id)
      .eq('config_key', 'OPENAI_API_KEY')
      .single();

    const apiKey = cfg?.config_value;
    if (!apiKey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'API key non configurata per il cliente' }) };
    }

    // 4. Logica server-side (es. chiamata a un'API di terzi con apiKey)...
    //    const result = await fetch('https://api.terzi.com/...', { headers: { Authorization: `Bearer ${apiKey}` }, ... });
    void payload; // usa il payload come necessario

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true /*, result */ }),
    };
  } catch (err: any) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Errore interno del server' }) };
  }
};
