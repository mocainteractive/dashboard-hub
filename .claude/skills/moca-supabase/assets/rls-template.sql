/*
  Template tabella + RLS per un'app integrata Moca Hub.

  Convenzioni (rispecchiano le migration dell'Hub):
  - Ogni tabella di dati applicativi ha una colonna `client_id` (multi-tenant).
  - RLS SEMPRE abilitata.
  - Le policy isolano i dati per cliente tramite la tabella ponte `user_clients`
    (un utente vede solo i clienti a cui è assegnato).
  - Naming file migration: AAAAMMGGHHMMSS_descrizione.sql (timestamp crescente).

  Sostituisci `app_esempio_items` con il nome reale della tua tabella.
*/

CREATE TABLE IF NOT EXISTS app_esempio_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  payload     jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Indici sui pattern di accesso più frequenti.
CREATE INDEX IF NOT EXISTS idx_app_esempio_items_client_id
  ON app_esempio_items (client_id);
CREATE INDEX IF NOT EXISTS idx_app_esempio_items_created_at
  ON app_esempio_items (created_at DESC);

-- RLS sempre abilitata.
ALTER TABLE app_esempio_items ENABLE ROW LEVEL SECURITY;

-- SELECT: l'utente vede le righe dei clienti a cui è assegnato.
CREATE POLICY "items_select_own_clients"
  ON app_esempio_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_clients
      WHERE user_clients.user_id = auth.uid()
        AND user_clients.client_id = app_esempio_items.client_id
    )
  );

-- INSERT: può inserire solo per un cliente a cui è assegnato.
CREATE POLICY "items_insert_own_clients"
  ON app_esempio_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_clients
      WHERE user_clients.user_id = auth.uid()
        AND user_clients.client_id = app_esempio_items.client_id
    )
  );

-- UPDATE: solo righe dei propri clienti (e resta nel proprio cliente).
CREATE POLICY "items_update_own_clients"
  ON app_esempio_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_clients
      WHERE user_clients.user_id = auth.uid()
        AND user_clients.client_id = app_esempio_items.client_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_clients
      WHERE user_clients.user_id = auth.uid()
        AND user_clients.client_id = app_esempio_items.client_id
    )
  );

-- DELETE: solo righe dei propri clienti.
CREATE POLICY "items_delete_own_clients"
  ON app_esempio_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_clients
      WHERE user_clients.user_id = auth.uid()
        AND user_clients.client_id = app_esempio_items.client_id
    )
  );

-- Trigger updated_at.
CREATE OR REPLACE FUNCTION set_app_esempio_items_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_app_esempio_items_updated_at ON app_esempio_items;
CREATE TRIGGER trg_app_esempio_items_updated_at
  BEFORE UPDATE ON app_esempio_items
  FOR EACH ROW EXECUTE FUNCTION set_app_esempio_items_updated_at();
