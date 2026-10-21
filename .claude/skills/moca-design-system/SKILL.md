---
name: moca-design-system
description: Applica il Design System v2.0 di Moca Hub a un'app integrata — layout, header a tre zone, card, palette di colori (design token), font Figtree, icone lucide-react e lingua italiana. Usa questa skill ogni volta che si costruisce o si rivede la UI di un'app satellite Moca: header, pagine, componenti, stili, coerenza visiva col brand Moca Interactive.
---

# Moca Design System v2.0

Regole vincolanti per la UI di ogni app integrata, così che sia
indistinguibile dall'Hub e dalle altre app dell'ecosistema.

## Principi non negoziabili

1. **Lingua: italiano** in tutta la UI (label, messaggi, errori, vuoti).
2. **Icone: `lucide-react`**. Mai emoji nelle interfacce di produzione.
3. **Font: Figtree** (Google Fonts) — vedi `assets/index-head.html`.
4. **Design token Moca** via Tailwind (vedi tabella sotto). Niente colori arbitrari.
5. **Logo Moca sempre visibile** nell'header (a destra, versione chiara/invertita).

## Design token (Tailwind)

Definiti in `tailwind.config.js` (vedi skill `moca-app-scaffold`):

| Token Tailwind | Hex | Uso |
|---|---|---|
| `moca-red` | `#E52217` | Primary: azioni, stati attivi, accenti |
| `moca-red-light` | `#FFE7E6` | Sfondo elementi selezionati/evidenziati |
| `moca-black` | `#191919` | Header, testo primario |
| `moca-gray` | `#8A8A8A` | Testo secondario |
| `moca-bg` | `#F3F4F6` | Sfondo pagina |
| `success` | `#22c55e` | Stati positivi |
| `warning` | `#f59e0b` | Avvisi |
| `danger` | `#ef4444` | Errori, azioni distruttive |

Superficie/Surface: `#FFFFFF` (bianco) per le card.

## Layout di base

```
┌──────────────────────────────────────────────┐
│  HEADER  (bg-moca-black, sticky, h-16)         │
│  [logo+nome cliente] [titolo app] [logo Moca]  │
├──────────────────────────────────────────────┤
│  MAIN  (bg-moca-bg)                            │
│    max-w-7xl mx-auto px-4 sm:px-6 lg:px-8      │
│    ┌────────── card bianca ──────────┐         │
│    │ bg-white shadow-sm rounded-xl p-6│        │
│    └──────────────────────────────────┘        │
└──────────────────────────────────────────────┘
```

### Header
Usa `assets/AppHeader.tsx` (port pronto, legge `useMoca()`):
- **sticky** in alto, `bg-moca-black text-white`, altezza `h-16`.
- **Sx**: logo cliente (`bg-white rounded-md p-1`) + nome cliente + nome/ruolo utente.
- **Centro**: titolo dell'app.
- **Dx**: logo Moca (`logo-light.svg`, `opacity-80`) + pulsante "Esci".

### Contenitore principale
```tsx
<main className="min-h-screen bg-moca-bg">
  <AppHeader appTitle="Nome App" />
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    {/* card e contenuti */}
  </div>
</main>
```

### Card standard
```tsx
<div className="bg-white shadow-sm rounded-xl p-6">
  <h2 className="text-lg font-semibold text-moca-black mb-4">Titolo sezione</h2>
  {/* ... */}
</div>
```

## Pattern UI ricorrenti

**Bottone primario**
```tsx
<button className="px-4 py-2 bg-moca-red text-white rounded-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
  Conferma
</button>
```

**Bottone secondario**
```tsx
<button className="px-4 py-2 border border-gray-300 text-moca-black rounded-md font-medium hover:bg-gray-100 transition-colors">
  Annulla
</button>
```

**Elemento di lista / nav attivo** (stesso stile della sidebar dell'Hub)
```tsx
className={active
  ? 'bg-moca-red-light text-moca-red border border-moca-red'
  : 'text-moca-black hover:bg-gray-100'}
```

**Badge di stato**
```tsx
<span className="px-2 py-0.5 text-xs rounded-full bg-success/10 text-success">Attivo</span>
```

**Loading spinner**
```tsx
<div className="animate-spin h-6 w-6 border-2 border-moca-red border-t-transparent rounded-full" />
```

## Responsività
- Mobile-first. Su mobile collassa il titolo centrale e mostra solo le icone.
- Padding pagina: `px-4 sm:px-6 lg:px-8`. Larghezza max contenuto: `max-w-7xl`.
- Nascondi testi secondari su schermi piccoli con `hidden sm:block` / `sm:inline`.

## Checklist UI
- [ ] Header a 3 zone con logo cliente (sx) e logo Moca (dx).
- [ ] Sfondo `moca-bg`, card `bg-white shadow-sm rounded-xl`.
- [ ] Solo token Moca, font Figtree, icone lucide-react.
- [ ] Tutti i testi in italiano (inclusi stati vuoti ed errori).
- [ ] Nessuna emoji nella UI.
- [ ] Pulsante di Feedback flottante in basso a destra (vedi skill `moca-feedback-widget`).
