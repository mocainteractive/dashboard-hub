/**
 * Client Supabase per un'app integrata Moca Hub.
 *
 * IMPORTANTE: usare la STESSA istanza Supabase dell'Hub (stessi URL e anon key),
 * così l'app condivide `auth` e le tabelle multi-tenant. Non creare un progetto
 * Supabase separato e non creare tabelle `users` locali.
 *
 * Usa SOLO la anon key nel frontend. La service_role key vive esclusivamente
 * nelle Netlify Functions (vedi skill moca-netlify-functions).
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  console.warn('[Supabase] VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY mancanti');
}

export const supabase = createClient(url, anonKey);

/** Esempio: query scoped per cliente attivo (RLS applica comunque l'isolamento). */
export async function listItems(clientId: string) {
  const { data, error } = await supabase
    .from('app_esempio_items')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
