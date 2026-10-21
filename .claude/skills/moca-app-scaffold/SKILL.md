---
name: moca-app-scaffold
description: Bootstrap di una nuova applicazione integrata nell'ecosistema Moca Hub (stack React 18 + TypeScript + Vite + Tailwind). Usa questa skill quando si crea da zero una nuova "app satellite" Moca, si imposta la struttura del progetto, le dipendenze, la configurazione build/Netlify, il provider di autenticazione e il Mock Mode per lo sviluppo locale. Punto di ingresso che rimanda alle skill verticali moca-design-system, moca-auth-token, moca-supabase e moca-netlify-functions.
---

# Moca App Scaffold

Crea una nuova applicazione **integrata e compatibile con Moca Hub**. L'Hub è
l'Identity Provider e il Configuration Manager centrale: le app satellite NON
gestiscono utenti/password e NON hardcodano API key — ricevono tutto dall'Hub
tramite il flusso del **launch token**.

## Stack obbligatorio

- **React 18 + TypeScript + Vite**
- **Tailwind CSS** con i design token Moca (vedi `assets/tailwind.config.js`)
- **lucide-react** per le icone (mai emoji)
- **@supabase/supabase-js** solo se l'app accede al DB condiviso
- Deploy su **Netlify** (con Netlify Functions per ogni logica server-side)
- **Lingua UI: italiano** (tassativo)

## Skill verticali correlate

Durante lo sviluppo, attiva la skill giusta per ogni aspetto:

| Aspetto | Skill |
|---|---|
| Layout, header, card, colori, font | `moca-design-system` |
| Launch token, sessione, getConfig, accesso negato | `moca-auth-token` |
| Connessione Supabase, RLS, scoping per client_id | `moca-supabase` |
| Backend, proxy API sicuri, segreti | `moca-netlify-functions` |
| Pulsante di Feedback (email via Resend) | `moca-feedback-widget` |

## Procedura di bootstrap

### 1. Inizializza il progetto
```bash
npm create vite@latest nome-app -- --template react-ts
cd nome-app
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
npm install lucide-react @supabase/supabase-js
npm install -D @netlify/functions
```

### 2. Applica i file di configurazione (da `assets/`)
- `tailwind.config.js` → radice progetto (design token Moca identici all'Hub).
- `netlify.toml` → radice progetto.
- `env.example` → copia in `.env.local` e compila (vedi sotto). **Mai committare `.env.local`.**
- Aggiungi a `src/index.css` in cima:
  ```css
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
  ```
- Importa il font Figtree in `index.html` (vedi `moca-design-system`).
- Aggiungi in `index.html` il **tracker di utilizzo centralizzato** (telemetria
  anonima di aperture/ruolo/tempo attivo, servito dall'Hub — così ogni app lo
  eredita e si aggiorna una sola volta lato Hub). Va **dopo** l'SDK:
  ```html
  <script src="https://moca-central-hub.netlify.app/moca-usage-tracker.js"></script>
  ```
  Opzionale: `window.__MOCA_IDLE_MINUTES__ = 2;` prima dello script per cambiare
  la soglia di inattività.

### 3. Copia l'SDK e il provider (da `assets/`)
- `moca-sdk.ts` → `src/lib/moca-sdk.ts` (port TypeScript dell'SDK ufficiale, stesso contratto di rete).
- `MocaProvider.tsx` → `src/lib/MocaProvider.tsx` (context React + gestione Mock/Accesso Negato).

### 4. Avvolgi l'app
```tsx
// src/main.tsx
import { MocaProvider } from './lib/MocaProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MocaProvider>
      <App />
    </MocaProvider>
  </StrictMode>
);
```
In qualsiasi componente:
```tsx
import { useMoca } from './lib/MocaProvider';
const { client, user, getConfig } = useMoca();
const apiKey = getConfig('OPENAI_API_KEY'); // mai hardcodare
```

### 5. Struttura cartelle consigliata
```
src/
  lib/
    moca-sdk.ts          # SDK tipizzato
    MocaProvider.tsx     # context auth/config
    supabase.ts          # client Supabase (se serve — vedi moca-supabase)
  components/
    AppHeader.tsx        # header Design System v2.0 (vedi moca-design-system)
  App.tsx
  main.tsx
netlify/
  functions/            # logica server-side (vedi moca-netlify-functions)
```

### 6. Variabili d'ambiente
Frontend (esposte al browser, prefisso `VITE_`):
- `VITE_MOCA_HUB_URL` — URL dell'Hub.
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — solo se l'app usa Supabase.

Backend (solo Netlify Functions, MAI nel browser):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

> ⚠️ La `SERVICE_ROLE_KEY` ha privilegi elevati e bypassa la RLS: non deve MAI
> finire in codice frontend o in variabili `VITE_`.

### 7. Aggiungi il widget di Feedback (obbligatorio)
Ogni app deve avere il pulsante di Feedback standard. Attiva la skill
`moca-feedback-widget`:
- copia `FeedbackWidget.tsx` → `src/components/` e `send-feedback.ts` → `netlify/functions/`;
- monta `<FeedbackWidget />` come ultimo figlio del layout autenticato in `App.tsx`;
- **configura `RESEND_API_KEY` su Netlify** (senza, il pulsante appare ma l'email non parte).

Le segnalazioni arrivano di default a `daniele.pisciottano@` e `luigi.iacono@mocainteractive.com`.

### 8. Registrazione nell'Hub
Dopo il deploy su Netlify, un super_admin registra la URL dell'app
(`https://nome-app.netlify.app`) nel pannello **Applicazioni** dell'Hub e
configura gli accessi (per utente / cliente / ruolo / livello).

## Checklist finale (Definition of Done)
- [ ] L'app si avvia solo con sessione valida (token o mock); altrimenti mostra "Accesso Negato".
- [ ] Nessuna API key hardcodata: tutte da `getConfig()` / Netlify Functions.
- [ ] Design System v2.0 rispettato (header dark, card bianche, Figtree, lucide, italiano).
- [ ] Eventuali nuove tabelle Supabase protette da RLS e scoped per `client_id`.
- [ ] Segreti server-side solo nelle Netlify Functions.
- [ ] Widget di Feedback presente (`<FeedbackWidget />`) e `RESEND_API_KEY` configurata su Netlify.
- [ ] `.env.local` non committato; `env.example` aggiornato.
