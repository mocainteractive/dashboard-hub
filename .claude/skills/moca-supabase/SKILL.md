---
name: moca-supabase
description: Collega un'app integrata Moca Hub al database Supabase condiviso e crea tabelle multi-tenant sicure. Usa questa skill per configurare il client Supabase, scrivere migration, definire la Row Level Security (RLS) scoped per client_id tramite la tabella user_clients, e fare query isolate per cliente. Riguarda il "collegamento a Supabase" e l'isolamento dei dati tra clienti.
---

# Moca Supabase

Le app satellite usano la **stessa istanza Supabase** dell'Hub. L'Hub possiede
`auth`, `users`, `clients`, `user_clients`, `configurations`, `applications`.
Un'app non duplica questi concetti: ci si appoggia.

## Regole fondamentali

1. **Stessa istanza**: stessi `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` dell'Hub.
2. **Mai** creare tabelle `users`/`clients` locali né un progetto Supabase separato.
3. **Solo anon key nel frontend.** La `service_role` key sta esclusivamente nelle
   Netlify Functions (bypassa la RLS — vedi `moca-netlify-functions`).
4. **Ogni nuova tabella applicativa**:
   - ha una colonna `client_id uuid REFERENCES clients(id)`;
   - ha **RLS abilitata**;
   - ha policy che isolano i dati per cliente.
5. Multi-tenancy: un utente accede ai dati solo dei clienti a cui è assegnato
   (relazione `user_clients`).

## Client Supabase
Copia `assets/supabase.ts` in `src/lib/supabase.ts`. Espone `supabase`
(anon key) per query lato browser; la RLS garantisce l'isolamento anche se il
frontend dimentica un filtro.

## Migration e RLS

Convenzione file: `supabase/migrations/AAAAMMGGHHMMSS_descrizione.sql`
(timestamp crescente, come nell'Hub).

Usa `assets/rls-template.sql` come base per ogni nuova tabella. Pattern canonico
delle policy (identico alle migration dell'Hub):

```sql
ALTER TABLE <tabella> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<nome>_select_own_clients"
  ON <tabella> FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_clients
      WHERE user_clients.user_id = auth.uid()
        AND user_clients.client_id = <tabella>.client_id
    )
  );
```

Replica lo stesso `EXISTS (...)` per INSERT/UPDATE/DELETE:
- **INSERT** → in `WITH CHECK`.
- **UPDATE** → sia in `USING` sia in `WITH CHECK` (impedisce di "spostare" una
  riga verso un altro cliente).
- **DELETE** → in `USING`.

> Senza RLS o senza il vincolo su `client_id`, un utente potrebbe leggere o
> scrivere dati di clienti non suoi. È il rischio di sicurezza #1 di queste app.

## Query lato app
Filtra sempre esplicitamente per il `client_id` attivo (preso da `useMoca()`),
anche se la RLS protegge comunque:
```ts
const { client } = useMoca();
const { data } = await supabase
  .from('app_esempio_items')
  .select('*')
  .eq('client_id', client.id)
  .order('created_at', { ascending: false });
```

## Operazioni privilegiate
Tutto ciò che richiede di scavalcare la RLS o usare segreti (es. creare righe per
conto di più clienti, job batch, accesso alla `service_role`) va fatto in una
**Netlify Function**, non nel frontend. Vedi `moca-netlify-functions`.

## Checklist
- [ ] Stessa istanza Supabase dell'Hub; solo anon key nel frontend.
- [ ] Nessuna tabella `users`/`clients` locale.
- [ ] Ogni tabella nuova ha `client_id` + RLS abilitata.
- [ ] Policy SELECT/INSERT/UPDATE/DELETE basate su `user_clients` + `auth.uid()`.
- [ ] UPDATE con `WITH CHECK` per evitare cross-tenant.
- [ ] Migration con timestamp crescente in `supabase/migrations/`.
