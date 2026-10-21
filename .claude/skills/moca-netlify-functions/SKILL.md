---
name: moca-netlify-functions
description: Costruisci il backend di un'app integrata Moca Hub con Netlify Functions — proxy API sicuri, operazioni privilegiate e gestione dei segreti server-side. Usa questa skill quando servono chiamate ad API di terzi con chiavi sensibili, logica che deve scavalcare la RLS (service_role), CORS, verifica del JWT utente e autorizzazione per client_id. Tiene i segreti fuori dal browser.
---

# Moca Netlify Functions (Backend)

Le Netlify Functions sono **obbligatorie** per qualunque logica server-side:
proxy verso API di terzi, operazioni con la `service_role` key, scraping, job.
Servono a tenere i segreti **fuori dal frontend**.

## Quando usarle (non opzionale)
- Chiamate ad API esterne con chiavi sensibili che non devono toccare il browser.
- Operazioni che richiedono la `service_role` (bypass RLS): batch, scritture
  cross-cliente, manutenzione.
- Qualunque cosa non possa essere protetta solo dalla RLS lato client.

## Struttura
```
netlify/
  functions/
    api-proxy.ts        # una funzione = un endpoint → /.netlify/functions/api-proxy
    utils/
      supabase-admin.ts  # client service_role (riusa il pattern dell'Hub)
```
Con il `netlify.toml` dello scaffold, `/api/*` è alias di `/.netlify/functions/*`.

## Pattern obbligatorio (vedi `assets/api-proxy.ts`)

Ogni funzione segue questi 4 passi, allineati alle funzioni dell'Hub:

1. **CORS**: gestisci `OPTIONS` (preflight) e usa un'**allow-list** di origin
   (no `*` per endpoint autenticati). Aggiungi la URL di produzione dell'app.
2. **Autenticazione**: leggi `Authorization: Bearer <jwt>` e verifica con
   `supabaseAdmin.auth.getUser(jwt)`. Niente token valido → `401`.
3. **Autorizzazione**: controlla che l'utente sia assegnato al `client_id`
   richiesto (via `user_clients`); `super_admin`/`manager` possono tutti i
   clienti. Altrimenti `403`. Senza questo controllo un utente potrebbe leggere
   le chiavi di clienti non suoi (IDOR), perché la service_role bypassa la RLS.
4. **Logica**: recupera la API key del cliente lato server da `configurations` e
   usala per la chiamata di terzi. **Mai** rimandare la chiave al browser.

## Segreti & variabili d'ambiente
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` → impostate su Netlify, usate solo
  qui. **Mai** con prefisso `VITE_`, mai nel bundle frontend.
- Il client admin disabilita refresh/persist:
  ```ts
  createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  ```

## Chiamata dal frontend
```ts
import { supabase } from '../lib/supabase';

const { data: { session } } = await supabase.auth.getSession();
const res = await fetch('/api/api-proxy', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ client_id: client.id, payload: { /* ... */ } }),
});
```
> Nota: se l'app usa il launch token (non la sessione Supabase), passa comunque
> un'identità verificabile (es. il JWT utente se disponibile) oppure valida il
> `moca_token` lato funzione. Non fidarti mai di un `client_id` non verificato.

## Sicurezza — checklist
- [ ] `OPTIONS` gestito; CORS con allow-list (no `*` su endpoint autenticati).
- [ ] JWT verificato con `auth.getUser` su ogni richiesta.
- [ ] Autorizzazione sul `client_id` (via `user_clients`) prima di leggere dati/chiavi.
- [ ] `service_role` solo server-side; nessun segreto in variabili `VITE_`.
- [ ] La API key del cliente non viene mai restituita al browser.
- [ ] Errori generici verso il client; log dettagliati solo server-side.

## Function di Feedback (obbligatoria)
Ogni app include la function `send-feedback.ts` che inoltra le segnalazioni del
widget via email (Resend). È volutamente **solo-email**, senza Supabase né auth
(vedi skill `moca-feedback-widget`). Ricorda di impostare `RESEND_API_KEY` tra le
variabili d'ambiente Netlify: senza, l'invio fallisce.
