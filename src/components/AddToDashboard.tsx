import { useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { useData } from '../lib/DataContext';
import { newLocalId } from '../lib/format';
import type { VizSpec } from '../shared/types';
import { Button, ErrorNote, Modal, Select, Spinner } from './ui';

/** Aggiunge una visualizzazione a una dashboard esistente o nuova. */
export function AddToDashboard({ spec, onClose }: { spec: VizSpec; onClose: () => void }) {
  const { api, dashboards, refreshDashboards } = useData();
  const [target, setTarget] = useState<string>(dashboards[0]?.id ?? 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    try {
      const widget = { id: newLocalId(), spec: { ...spec, id: newLocalId() }, w: (spec.type === 'kpi' ? 1 : 2) as 1 | 2 };
      if (target === 'new') await api.saveDashboard({ title: spec.title, widgets: [widget], filters: { dims: [] } });
      else {
        const d = await api.getDashboard(target);
        await api.saveDashboard({ ...d, widgets: [...d.widgets, widget] });
      }
      await refreshDashboards();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Aggiungi alla dashboard"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={add} disabled={busy}>
            {busy ? <Spinner size={4} /> : <LayoutDashboard size={16} />} Aggiungi
          </Button>
        </>
      }
    >
      <p className="text-sm text-moca-text mb-3">
        Il grafico <strong className="text-moca-text">{spec.title}</strong> verrà aggiunto con i suoi dati salvati: riaprendo la dashboard non servono nuove chiamate ai server.
      </p>
      <Select value={target} onChange={(e) => setTarget(e.target.value)}>
        {dashboards.map((d) => (
          <option key={d.id} value={d.id}>
            {d.title}
          </option>
        ))}
        <option value="new">Nuova dashboard</option>
      </Select>
      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}
