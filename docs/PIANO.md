# PIANO DI PROGETTO: DASHBOARD HUB

App satellite del Moca Hub che costruisce dashboard interattive sui dati di un
cliente, leggendoli dai server MCP di Moca (GA4, Search Console, Google Ads,
Meta, Pinterest), con chat AI sui dati, storico e cache intelligente.

**Requisito numero uno: isolamento totale tra clienti.** Un cliente vede solo
i suoi dati, in nessun caso quelli di un altro cliente.

---

## 1. OBIETTIVI

- **Perimetro dal Data Lake.** La configurazione del cliente è l'output
  dell'app Onboarding Data Lake (`clients/<slug>.json`), salvata nell'Hub come
  configurazione del cliente con chiave `DATA_LAKE_CLIENT_JSON`. Gli account
  elencati lì (proprietà GA4, siti Search Console, customer Google Ads, ad
  account Meta e Pinterest) sono gli unici interrogabili dall'app.
- **Dashboard interattive.** Widget (KPI, linee, aree, barre, torte, tabelle,
  dispersione), filtri globali per periodo e dimensione, filtro incrociato con
  un clic su un elemento del grafico, editor visuale dei widget.
- **Incrociare i dati.** Unione di due dataset su una colonna comune (es. data)
  per confrontare fonti diverse nello stesso grafico.
- **Chat con i dati.** Assistente AI con Anthropic, OpenAI o Gemini (chiavi
  dall'Hub: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) che
  interroga gli MCP, salva dataset e crea visualizzazioni da aggiungere alle
  dashboard.
- **Memoria.** Storico delle conversazioni, dei dataset e delle dashboard per
  cliente, condiviso tra i colleghi che lavorano sullo stesso cliente.
- **Cache intelligente.** Dati già visti non richiedono nuove chiamate MCP.

---

## 2. ARCHITETTURA

```
Hub (cliente X) --launch token--> start-session (Function)
                                     |  valida il token con l'Hub, server-to-server
                                     |  legge DATA_LAKE_CLIENT_JSON e le chiavi AI
                                     v
                     sessione SIGILLATA (AES-256-GCM, 8 ore)
                     { utente, cliente X, perimetro account, chiavi AI }
                                     |
Browser (solo token opaco, nessuna chiave) ---> Functions dell'app
                                     |
         +---------------------------+---------------------------+
         |                           |                           |
   data (CRUD)               chat-start  ->  agent-run-background
   dataset, dashboard,        (crea il run)    ciclo AI con strumenti
   conversazioni, cache                         |
         |                                      v
         |                               MCP GUARD (deterministico)
         |                               autorizza, inietta, filtra
         |                                      |
         v                                      v
   Netlify Blobs, chiavi                 Server MCP Moca
   t/<cliente X>/...                     (cache per cliente)
```

- **Stack:** React 18, TypeScript, Vite, Tailwind con token Moca, lucide-react,
  Recharts, Netlify Functions, Netlify Blobs (come Onboarding Data Lake: nessuna
  migration sul database condiviso dell'Hub).
- **Nessuna chiave nel browser.** start-session toglie dalla risposta tutte le
  configurazioni: il browser riceve solo cliente, utente, il riepilogo del
  perimetro e i provider AI disponibili. Chiavi e perimetro viaggiano dentro la
  sessione cifrata, leggibile solo dalle Functions.
- **Operazioni lunghe:** il ciclo dell'agente gira in una background function
  (fino a 15 minuti, budget 12) e il browser legge l'avanzamento con polling.
  Nessuna function sincrona supera i 10 secondi.

---

## 3. SICUREZZA E ISOLAMENTO (BLINDATURA)

L'isolamento non dipende dal comportamento dell'AI: anche un modello
manipolato (prompt injection nei dati) non può leggere dati di altri clienti,
perché ogni chiamata passa da controlli deterministici lato server.

### 3.1 IDENTITÀ E CLIENTE

1. Il launch token dell'Hub è monouso (5 minuti) e lo valida la function
   start-session, server-to-server. L'Hub lo rilascia solo per i clienti
   assegnati all'utente (`user_clients`).
2. Il cliente della sessione è quello del token. Nessuna API accetta un
   `client_id` dal browser: il cliente si legge solo dalla sessione cifrata.
3. La sessione è cifrata e autenticata (AES-256-GCM, chiave derivata con HKDF
   da `SESSION_SECRET`): non si può leggere né modificare, scade dopo 8 ore.

### 3.2 PERIMETRO DEGLI ACCOUNT

1. Il perimetro arriva solo da `DATA_LAKE_CLIENT_JSON`, configurazione del
   cliente nell'Hub (tabella `configurations`, legata al `client_id`).
2. Senza configurazione valida l'app non fa nessuna chiamata MCP e mostra
   cosa manca.
3. Se la configurazione cambia, dataset e cache che usano account non più nel
   perimetro diventano invisibili.

### 3.3 MCP GUARD (il cuore della blindatura)

Ogni chiamata a un server MCP passa da `netlify/functions/utils/mcp-guard.ts`:

- **Strumenti vietati:** quelli che elencano account di tutta l'agenzia
  (`list_ad_accounts`, `list_clients`, `list_customers`, `get_properties`...)
  non sono mai esposti all'AI. Regola fail-closed: uno strumento è ammesso
  solo se ha un parametro di account (ancorato al perimetro) oppure un ID
  oggetto obbligatorio già verificato.
- **Parametro account sempre imposto:** il valore viene validato contro il
  perimetro e riscritto nel formato canonico. Se manca, viene iniettato
  (importante: alcuni server usano un "account di default" se il parametro è
  assente). Con più account nel perimetro l'AI deve scegliere tra quelli
  ammessi.
- **Argomenti sconosciuti rifiutati:** solo i parametri dichiarati dallo
  schema dello strumento, così non si può aggirare il controllo con un nome
  alternativo.
- **ID nei testi liberi:** ogni stringa degli argomenti (es. query GAQL) viene
  analizzata: se contiene ID di account fuori perimetro la chiamata è bloccata.
- **ID oggetto verificati:** campagne, ad set, annunci, creatività, video sono
  ammessi solo se sono comparsi in una risposta di un account del cliente
  (registro "ID osservati" per cliente).
- **Filtro in uscita:** dalle risposte vengono rimossi riferimenti ad account
  esterni; per gli strumenti ancorati a un oggetto, una risposta che cita un
  account esterno viene bloccata per intero.

### 3.4 ARCHIVIO E CACHE

- Ogni dato salvato vive sotto `t/<id cliente>/...` in Netlify Blobs. Le
  chiavi si costruiscono solo con la classe `TenantStore`, creata a partire
  dalla sessione verificata; gli ID arrivano dal server e vengono validati
  (niente `/`, `..` o caratteri liberi).
- La cache MCP è per cliente: la stessa chiamata per due clienti non condivide
  mai il risultato.

### 3.5 ALTRO

- Functions in same-origin, nessun CORS aperto.
- Errori generici verso il browser, dettagli solo nei log del server, mai
  chiavi nei log.
- Test automatici sul guard, sulla sessione, sul perimetro e sull'archivio.

---

## 4. CACHE INTELLIGENTE (TRE LIVELLI)

1. **Cache delle chiamate MCP** (server, per cliente). Chiave: hash di
   piattaforma, strumento e argomenti normalizzati. Scadenza in base al
   periodo richiesto:
   - periodi relativi o che includono oggi (`last_30d`, `this_month`): 1 ora;
   - periodi chiusi che terminano negli ultimi 3 giorni: 6 ore (i dati
     possono ancora assestarsi);
   - periodi chiusi più vecchi: 30 giorni.
2. **Catalogo dei dataset** (semantico). Ogni risposta dell'AI viene salvata
   come dataset tabellare con descrizione, fonti e periodo. Prima di chiamare
   gli MCP l'assistente riceve il catalogo e usa `query_dataset` per filtrare
   e aggregare i dati già presenti, senza nuove chiamate.
3. **Browser.** Dataset e dashboard si caricano una volta per sessione; filtri,
   aggregazioni e incroci si calcolano in locale, istantaneamente.

Il pulsante "Aggiorna" su un dataset forza la rilettura. La pagina Perimetro
mostra statistiche di cache (risposte riusate, chiamate fatte).

---

## 5. FUNZIONALITÀ (UI)

- **Dashboard:** elenco dashboard del cliente, griglia di widget, barra filtri
  (periodo, dimensione), filtro incrociato al clic, editor widget (dataset,
  tipo, assi, metriche, aggregazione, filtri, incrocio con un secondo dataset),
  duplica, elimina, ridimensiona.
- **Chat AI:** storico conversazioni, scelta del provider, avanzamento passo
  per passo (con indicazione "da cache"), visualizzazioni nella risposta con
  "Aggiungi alla dashboard", domande rapide di esempio.
- **Dati:** catalogo dataset, tabella con ricerca e ordinamento, incrocio di
  due dataset, esportazione CSV.
- **Perimetro:** account del cliente letti dal Data Lake, server MCP attivi,
  statistiche e svuotamento della cache.

---

## 6. FILE PRINCIPALI

| File | Ruolo |
|---|---|
| `src/shared/scope.ts` | lettura di `DATA_LAKE_CLIENT_JSON` e perimetro |
| `src/shared/engine.ts` | filtri, aggregazioni, incroci (browser e server) |
| `netlify/functions/utils/session.ts` | sessione cifrata |
| `netlify/functions/utils/mcp-guard.ts` | blindatura delle chiamate MCP |
| `netlify/functions/utils/tenant-store.ts` | archivio per cliente |
| `netlify/functions/utils/mcp-cache.ts` | cache MCP con scadenze |
| `netlify/functions/utils/llm.ts` | Anthropic, OpenAI, Gemini |
| `netlify/functions/utils/agent.ts` | ciclo dell'assistente e strumenti |
| `netlify/functions/start-session.ts` | apertura sessione dall'Hub |
| `netlify/functions/data.ts` | dataset, dashboard, conversazioni, cache |
| `netlify/functions/chat-start.ts` | avvio di una risposta AI |
| `netlify/functions/agent-run-background.ts` | esecuzione dell'assistente |

---

## 7. RILASCIO

1. Sito Netlify collegato a `mocainteractive/dashboard-hub`.
2. Variabili (vedi `.env.example`): `SESSION_SECRET`, `MCP_*_URL`,
   `RESEND_API_KEY`.
3. Nell'Hub, per ogni cliente: configurazione `DATA_LAKE_CLIENT_JSON` con il
   contenuto di `clients/<slug>.json` e almeno una chiave AI.
4. Registrazione nel pannello Applicazioni con `required_api_keys:
   ["DATA_LAKE_CLIENT_JSON", "ANY_LLM"]`, prima in `maintenance`, poi `active`.

## 8. EVOLUZIONI POSSIBILI

- Lettura diretta da BigQuery del data lake (oltre agli MCP) con lo stesso
  perimetro.
- Dashboard pianificate via email.
- Spostamento dello storico su Supabase con RLS per `client_id`, se servirà
  interrogarlo dall'Hub (App Outputs API).
