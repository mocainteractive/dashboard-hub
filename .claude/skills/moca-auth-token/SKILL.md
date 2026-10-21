---
name: moca-auth-token
description: Implementa autenticazione e configurazione di un'app integrata Moca Hub tramite il flusso del launch token e le API key per-cliente. Usa questa skill per gestire login centralizzato, validazione del moca_token, recupero sicuro delle configurazioni con getConfig, schermata "Accesso Negato", sessione (sessionStorage 8h) e Mock Mode locale. Riguarda il "funzionamento tramite token" e il non-hardcoding delle chiavi.
---

# Moca Auth & Token

Moca Hub è l'**Identity Provider** e il **Configuration Manager**. Un'app
satellite non gestisce password né conserva API key: le riceve dall'Hub.

## Modello di accesso

```
Utente nell'Hub clicca "Apri App"
   → Hub genera un launch token monouso (scade in 5 min)
   → redirect all'app con ?moca_token=xxx
   → l'app valida il token con l'Hub
   → l'Hub restituisce { client, user, application, configurations }
   → l'app salva la sessione (sessionStorage, 8h) e parte
```

- **Launch token**: monouso, TTL 5 minuti. È esso stesso la prova di
  autenticazione (la validazione NON richiede un Bearer token).
- **Sessione app**: salvata in `sessionStorage` (chiave `moca_session`),
  scade dopo 8 ore o alla chiusura del tab.
- **Contesto cliente**: ogni istanza dell'app è legata a un `client_id`.

## Via principale: SDK + launch token

Usa l'SDK tipizzato e il provider forniti dalla skill `moca-app-scaffold`
(`src/lib/moca-sdk.ts`, `src/lib/MocaProvider.tsx`).

```tsx
import { useMoca } from './lib/MocaProvider';

function Schermata() {
  const { client, user, getConfig } = useMoca();
  const openaiKey = getConfig('OPENAI_API_KEY'); // null se non configurata
  // ...
}
```

Il `MocaProvider`:
1. chiama `moca.init()` una sola volta all'avvio;
2. mostra uno spinner durante la validazione;
3. se fallisce → renderizza **Accesso Negato** (link all'Hub);
4. se ok → espone `client`, `user`, `configs`, `getConfig`, `logout`.

### Contratto `POST /api/validate-launch-token`
Request: `{ "token": "<launch-token>" }` (no Authorization header).

Risposta `200`:
```json
{
  "success": true,
  "client": { "id": "...", "name": "...", "email": "...", "logo_url": "..." },
  "user": { "id": "...", "name": "...", "email": "...", "role": "specialist", "level": 2, "job_title": "SEO" },
  "application": { "id": "...", "name": "...", "description": "..." },
  "configurations": { "OPENAI_API_KEY": "sk-...", "APIFY_API_KEY": "..." }
}
```

Errori (status / `code`): `401 INVALID_TOKEN`, `403 TOKEN_CONSUMED`,
`403 TOKEN_EXPIRED`. In tutti questi casi → mostra "Accesso Negato".

**Ruoli reali dell'Hub**: `super_admin`, `manager`, `specialist`, `external`
(con `level` numerico). Usa questi valori per gating di funzionalità lato app.

## Via alternativa: sessione Supabase condivisa

Se l'app condivide la sessione Supabase dell'Hub (stesso dominio/cookie o JWT
passato), può recuperare le config con il JWT utente:

### Contratto `POST /api/get-client-config`
Header: `Authorization: Bearer <user_jwt>`
Body: `{ "config_key": "OPENAI_API_KEY" }` (opzionale `client_id`, `config_type`).

Risposta con chiave singola:
```json
{ "success": true, "config_key": "OPENAI_API_KEY", "config_value": "sk-...", "config_type": "api_key" }
```
Senza `config_key` restituisce l'array `configurations`. L'endpoint applica
l'autorizzazione per `client_id`: un utente può leggere solo i clienti a cui è
assegnato (super_admin/manager possono leggere tutti).

> Scegli **una** via. Per app aperte dall'Hub, usa il launch token (più semplice
> e disaccoppiato). La via JWT serve quando l'app vive sotto lo stesso dominio
> e condivide già la sessione Supabase.

## Regole sulle chiavi (tassative)
- **Mai** hardcodare API key nel codice o nel repo.
- Ottieni le chiavi solo da `getConfig()` (launch token) o `get-client-config` (JWT).
- Le chiavi vivono nel browser solo il minimo indispensabile; per chiamate
  sensibili passale a una Netlify Function (vedi `moca-netlify-functions`) invece
  di chiamare direttamente le API di terzi dal frontend quando possibile.
- Non loggare mai i valori delle chiavi (al massimo mascherati: `••••1234`).

## Mock Mode (sviluppo locale)
Su `localhost`/`127.0.0.1`, prima di `init()`, abilita il mock (già predisposto
nel `MocaProvider`). Le chiavi di test vengono da `.env.local` (`VITE_DEV_*`),
**mai** committate:
```ts
moca.enableMockMode({
  client: { name: 'Cliente Demo', logo_url: '...' },
  user: { name: 'Sviluppatore', role: 'super_admin' },
  configurations: { OPENAI_API_KEY: import.meta.env.VITE_DEV_OPENAI_API_KEY ?? '' },
});
```

## Checklist
- [ ] `init()` chiamato una sola volta all'avvio (via MocaProvider).
- [ ] Stato non autenticato → schermata "Accesso Negato" con link all'Hub.
- [ ] Nessuna chiave hardcodata; tutte da `getConfig()` / endpoint Hub.
- [ ] Gating funzionalità basato sui ruoli reali (super_admin/manager/specialist/external).
- [ ] Mock Mode attivo solo in locale e senza chiavi reali nel repo.
