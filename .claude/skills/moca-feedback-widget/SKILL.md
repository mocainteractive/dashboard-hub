---
name: moca-feedback-widget
description: Aggiunge il widget di Feedback standard di Moca Hub a un'app integrata. Usa questa skill ogni volta che si crea o si aggiorna un'app satellite Moca, per inserire il pulsante flottante "Feedback" (segnalazione problemi/suggerimenti con screenshot) e la Netlify Function che inoltra le segnalazioni via email al team. Riguarda il "pulsante di feedback", la raccolta bug/suggerimenti dagli utenti e la configurazione di Resend.
---

# Moca Feedback Widget

Ogni app satellite Moca Hub **deve** includere il widget di Feedback: un
pulsante flottante in basso a destra che permette all'utente di segnalare
problemi, suggerimenti o domande (con screenshot) direttamente dall'app. Le
segnalazioni vengono inoltrate via email al team tramite [Resend](https://resend.com).

Questo garantisce un canale di feedback **uniforme** su tutte le app
dell'ecosistema, identico a quello del Moca Hub.

## Cosa installa

Due file, da copiare **identici** in ogni app (sono self-contained):

| File | Ruolo |
|---|---|
| `src/components/FeedbackWidget.tsx` | Widget React (pulsante flottante + pannello). Nessuna dipendenza esterna: icone SVG inline, colore brand inline, non usa `lucide-react` né l'SDK Moca. |
| `netlify/functions/send-feedback.ts` | Function solo-email: riceve la segnalazione e la inoltra via Resend. Nessun Supabase, nessuna auth. |

> Perché self-contained? Così il widget si incolla **uguale** in qualsiasi app,
> a prescindere da versione di Tailwind, presenza di `lucide-react` o struttura
> dell'SDK Moca. Non modificarlo per adattarlo: copialo così com'è.

## Procedura (3 passi)

### 1. Copia i due file (da `assets/`)
- `assets/FeedbackWidget.tsx` → `src/components/FeedbackWidget.tsx`
- `assets/send-feedback.ts` → `netlify/functions/send-feedback.ts`

Poi apri `netlify/functions/send-feedback.ts` e imposta il nome dell'app nella
costante `APP_NAME` (compare nell'oggetto dell'email). In alternativa lascialo
com'è e definisci la env `FEEDBACK_APP_NAME` su Netlify.

### 2. Monta il widget in `App.tsx`
Aggiungi l'import e inserisci `<FeedbackWidget />` come **ultimo figlio** del
layout principale autenticato (dopo il `<Footer />`). Essendo `position: fixed`
è auto-contenuto: non richiede provider e non altera il layout.

```tsx
import { FeedbackWidget } from './components/FeedbackWidget';

// ...dentro il return del layout autenticato:
      <Footer appName={APP_NAME} />
      <FeedbackWidget />
    </div>
```

Se l'app ha un wrapper `<MocaProvider>…</MocaProvider>`, va bene anche montarlo
come ultimo figlio dentro il provider.

### 3. Configura Resend su Netlify (OBBLIGATORIO)
Il widget **si vede sempre**, ma senza queste variabili d'ambiente la function
risponde con errore e l'email non parte. Su **Netlify → Site settings →
Environment variables** aggiungi:

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `RESEND_API_KEY` | ✅ | Chiave API Resend (la stessa usata dall'Hub). |
| `FEEDBACK_TO_EMAIL` | ⛔️ (opzionale) | Destinatari separati da virgola. Default: `daniele.pisciottano@mocainteractive.com,luigi.iacono@mocainteractive.com`. |
| `FEEDBACK_FROM_EMAIL` | ⛔️ (opzionale) | Mittente verificato su Resend. Default: `Moca Hub <onboarding@resend.dev>`. |
| `FEEDBACK_APP_NAME` | ⛔️ (opzionale) | Nome dell'app nell'oggetto dell'email. |

> ⚠️ **Ricordati sempre di impostare `RESEND_API_KEY` su Netlify.** È il passo
> più facile da dimenticare: il pulsante appare comunque, ma l'invio fallisce
> finché la chiave non è configurata.

## Destinatari di default

Le email arrivano a **daniele.pisciottano@mocainteractive.com** e
**luigi.iacono@mocainteractive.com**. Per cambiarli non toccare il codice: usa
la env `FEEDBACK_TO_EMAIL` (lista separata da virgola).

## Note tecniche
- La function espone `/.netlify/functions/send-feedback`; il widget la chiama in
  same-origin (nessun CORS, nessun token necessario).
- Gli screenshot vengono ridimensionati e compressi lato client prima dell'invio,
  per restare sotto il limite di payload di Netlify.
- L'**email per il ricontatto è obbligatoria**: il widget non invia la
  segnalazione senza un indirizzo valido e la function risponde `400` se manca.
  Così il team può sempre rispondere a chi ha segnalato.
- Il salvataggio su database (tabella `feedback`) esiste **solo nell'Hub**. Nelle
  app satellite la versione è volutamente **solo-email**: non creare tabelle né
  auth per il feedback.

## Checklist (Definition of Done)
- [ ] `FeedbackWidget.tsx` copiato in `src/components/` (invariato).
- [ ] `send-feedback.ts` copiato in `netlify/functions/`, con `APP_NAME` impostato.
- [ ] `<FeedbackWidget />` montato in `App.tsx` (dopo il Footer / ultimo nel layout).
- [ ] `RESEND_API_KEY` configurata su Netlify per questa app.
- [ ] Testato: il pulsante "Feedback" appare in basso a destra e l'email arriva.
