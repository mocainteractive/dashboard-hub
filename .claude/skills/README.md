# Skill Claude per app integrate Moca Hub

Set di skill verticali per **Claude Code** che guidano lo sviluppo di
applicazioni "satellite" integrate e compatibili con il Moca Hub, nel rispetto
di layout, design, funzionamento tramite token e collegamento a Supabase.

## Le skill

| Skill | Quando si attiva |
|---|---|
| **moca-app-scaffold** | Bootstrap di una nuova app (React+TS+Vite+Tailwind), struttura, config, provider. Punto di ingresso. |
| **moca-design-system** | UI: Design System v2.0 — header, card, token, font Figtree, icone lucide, italiano. |
| **moca-auth-token** | Login centralizzato, launch token, `getConfig`, sessione, Accesso Negato, Mock Mode. |
| **moca-supabase** | Istanza condivisa, migration, RLS scoped per `client_id`, query isolate. |
| **moca-netlify-functions** | Backend: proxy API sicuri, segreti server-side, autorizzazione per cliente. |
| **moca-feedback-widget** | Pulsante di Feedback standard (segnalazioni via email con Resend). Obbligatorio in ogni app. |

Ogni skill contiene un `SKILL.md` (istruzioni) e una cartella `assets/` con file
di template pronti all'uso (SDK TypeScript, provider React, header, config
Tailwind/Netlify, template RLS, esempio di function).

## Come si usano

Le skill si attivano automaticamente quando Claude Code lavora su un task
pertinente (es. "crea una nuova app Moca", "imposta la RLS", "fai l'header").
Si possono anche invocare esplicitamente con `/moca-app-scaffold`, ecc.

## Usarle in un altro repository (la nuova app)

Le skill di Claude Code sono lette dalla cartella `.claude/skills/` del
repository in cui Claude è in esecuzione. Per usarle nello sviluppo di una nuova
app satellite, hai due opzioni:

1. **Per progetto**: copia questa cartella `.claude/skills/` nel repo della nuova app.
2. **Globale (per l'utente)**: copia le cartelle in `~/.claude/skills/` così sono
   disponibili in tutti i progetti.

Questo repository (`moca-central-hub`) resta la **fonte canonica**: aggiorna qui
le skill quando cambiano i contratti dell'Hub (endpoint, design token, ruoli) e
ridistribuiscile.

## Riferimenti nel repo
- `docs/APP_INTEGRATION_GUIDE.md` — guida d'integrazione e Design System v2.0.
- `docs/ARCHITECTURE.md` — architettura e requisiti per nuove app.
- `docs/moca-sdk/` — SDK JavaScript ufficiale e template HTML.
- `netlify/functions/validate-launch-token.ts`, `get-client-config.ts`,
  `generate-launch-token.ts` — contratti reali degli endpoint.
