# Dashboard Hub

App satellite del Moca Hub che costruisce **dashboard interattive** sui dati di
un cliente, leggendoli dai server MCP di Moca (GA4, Search Console, Google Ads,
Meta, Pinterest), con **chat AI sui dati** (Claude, in streaming),
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
3. Aggiungi la chiave `ANTHROPIC_API_KEY` (del cliente o globale). Facoltativi
   `AI_MODEL_ANTHROPIC` (predefinito `claude-opus-5-5`) e `AI_EFFORT`
   (`low`, `medium`, `high`, `xhigh`, `max`; predefinito `medium`).
4. Apri l'app dall'Hub: la pagina **Perimetro e cache** mostra gli account
   letti e quali sono interrogabili.

## Provare il POC in locale (senza Netlify)

Il POC fa girare app e API sul tuo computer con i **server MCP reali** e
Claude: nessun deploy, nessun credito Netlify.

```bash
npm ci
cp .env.poc.example .env.poc   # compila cliente, chiave Anthropic e MCP_*_URL
npm run poc                     # http://localhost:5180
npm run poc:test                # in un altro terminale: test completo e report
```

`npm run poc:test` usa Claude e i server MCP veri (ha un costo, di solito
pochi dollari): crea la dashboard predefinita, rilegge ogni grafico per un
altro periodo, fa una serie di domande in chat per ogni piattaforma del
cliente, ripete una domanda per verificare la cache e scrive un report con
esiti, tempi, token e costi in `.poc-data/report-<data>.md`.

- Il cliente è il JSON di Onboarding Data Lake (`POC_CLIENT_FILE`): il
  perimetro e il guard sono gli stessi della versione su Netlify.
- La chat è in streaming: testo, passaggi e grafici arrivano mentre
  l'assistente lavora; il pulsante Interrompi ferma la risposta.
- Le risposte MCP diventano tabelle sul server (`tabular.ts`): il modello
  riceve un'anteprima e lavora sull'id (`t1`, `t2`), senza ricopiare i dati.
  Le chiamate MCP dello stesso passaggio partono in parallelo; con molti
  strumenti Claude carica solo quelli che servono (ricerca strumenti).
- Dashboard predefinita: un clic crea i grafici principali di ogni
  piattaforma (GA4, Search Console, Meta, Google Ads, Pinterest) senza AI,
  quindi senza costi Claude, come ricette filtrabili per periodo.
- Costi: ogni risposta in chat mostra durata e costo stimato (token di
  Claude ai prezzi di listino); la pagina Perimetro e cache mostra il totale
  per cliente.
- Dashboard a griglia libera (12 colonne): i widget si spostano trascinandoli
  dal titolo, si affiancano e si ridimensionano dall'angolo o dai bordi.
- Il periodo scelto vale per tutti i widget. Ogni dataset è una ricetta:
  chiamata MCP, tabella estratta e trasformazione (filtri, raggruppamenti,
  ordinamento, colonne rinominate) applicata dal server. Se il dataset non
  copre il periodo, il server ripete la ricetta con le nuove date (guard e
  cache come sempre). I vecchi dataset scritti a mano in chat si rendono
  filtrabili con "Rendi filtrabile con l'AI": l'assistente li ricrea come
  ricetta e i grafici passano da soli al nuovo dataset.
- Dati, dataset, dashboard, conversazioni e cache restano in `.poc-data/`.
  Per cambiare cliente modifica `.env.poc` e riavvia: la sessione si rinnova
  da sola.
- Il server (`server/poc.ts`) è già la base per un servizio Cloud Run con
  streaming.

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
- `server/`: POC locale (frontend, API e chat in streaming in un solo
  processo, archivio su file).
- `.claude/skills/`: skill moca-* copiate da `moca-central-hub`.

## Comandi

```bash
npm ci
npm run poc        # POC locale con MCP reali e Claude (vedi sopra)
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
   l'Hub). `netlify.toml` salta le build di branch e deploy preview: si
   pubblica solo il branch di produzione.
2. Variabili: `SESSION_SECRET`, `RESEND_API_KEY`, `MCP_*_URL`.
3. Un super_admin registra l'URL nel pannello Applicazioni dell'Hub con
   `required_api_keys: ["DATA_LAKE_CLIENT_JSON", "ANTHROPIC_API_KEY"]`, prima in
   `maintenance`, poi `active`. Accesso anche per gli utenti `external` del
   cliente: vedono solo il proprio cliente.
