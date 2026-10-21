# Dashboard Hub

App satellite del Moca Hub che costruisce **dashboard interattive** sui dati di
un cliente, leggendoli dai server MCP di Moca (GA4, Search Console, Google Ads,
Meta, Pinterest), con **chat AI sui dati** (Anthropic, OpenAI, Gemini),
**storico** di conversazioni, dataset e dashboard, e **cache intelligente**.

**Un cliente vede solo i suoi dati.** Il perimetro è l'output dell'app
Onboarding Data Lake, salvato nell'Hub come configurazione del cliente; ogni
chiamata MCP passa da un controllo deterministico lato server.

Piano completo, architettura e modello di sicurezza: [`docs/PIANO.md`](docs/PIANO.md).

## Configurare un cliente

1. Apri **Onboarding Data Lake** sul cliente e copia il JSON prodotto
   (`clients/<slug>.json`).
2. Nell'Hub, scheda del cliente, aggiungi la configurazione
   `DATA_LAKE_CLIENT_JSON` (tipo *setting*) con quel JSON come valore.
3. Aggiungi almeno una chiave AI: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` o
   `GEMINI_API_KEY` (del cliente o globale). Facoltativi `AI_MODEL_*` per
   cambiare modello (predefiniti: `claude-opus-5-5`, `gpt-5`, `gemini-2.5-flash`).
4. Apri l'app dall'Hub: la pagina **Perimetro e cache** mostra gli account
   letti e quali sono interrogabili.

## Come funziona la blindatura

- `start-session` valida il launch token con l'Hub e rilascia una **sessione
  cifrata** (AES-256-GCM) con cliente, perimetro e chiavi AI. Il browser non
  riceve nessuna configurazione.
- Nessuna API accetta un `client_id` dal browser: tutto lo storico vive sotto
  `t/<cliente>/` in Netlify Blobs (`TenantStore`).
- `mcp-guard.ts`: strumenti che elencano altri clienti vietati, parametro di
  account sempre imposto dal perimetro (anche se l'AI lo omette), argomenti
  non dichiarati rifiutati, ID esterni nei testi liberi rifiutati, ID oggetto
  ammessi solo se già visti per il cliente, risposte filtrate.
- Cache MCP per cliente, mai condivisa; anche un risultato in cache passa dal
  guard.

## Struttura

- `src/shared/`: tipi, perimetro (`scope.ts`), motore dati (`engine.ts`),
  condivisi tra browser e Functions.
- `src/views/`: Dashboard, Chat con i dati, Dati, Perimetro e cache.
- `src/components/`: grafici (Recharts, palette Moca validata), editor
  widget, filtri, header e widget Feedback dell'Hub.
- `netlify/functions/`: `start-session`, `data`, `chat-start`,
  `agent-run-background`, `send-feedback`; logica in `utils/`.
- `.claude/skills/`: skill moca-* copiate da `moca-central-hub`.

## Comandi

```bash
npm ci
npm run dev        # su localhost parte la demo con dati di esempio, senza Hub
npm test           # test di isolamento, guard, cache, motore dati, assistente
npm run lint
npm run build
```

Con `netlify dev` le Functions girano davvero: impostare in `.env` le
variabili `DEV_*` (vedi `.env.example`, mai su Netlify).

## Rilascio

1. Sito Netlify collegato a questo repository (build da `netlify.toml`). Le
   background function richiedono un piano Netlify che le supporti (come
   l'Hub).
2. Variabili: `SESSION_SECRET`, `RESEND_API_KEY`, `MCP_*_URL`.
3. Un super_admin registra l'URL nel pannello Applicazioni dell'Hub con
   `required_api_keys: ["DATA_LAKE_CLIENT_JSON", "ANY_LLM"]`, prima in
   `maintenance`, poi `active`. Accesso anche per gli utenti `external` del
   cliente: vedono solo il proprio cliente.
