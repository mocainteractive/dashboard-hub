import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Brain, CheckCircle2, ChevronDown, Database, LayoutDashboard, MessageSquarePlus, RefreshCw, Send, Server, ShieldAlert, Sparkles, Square, Trash2, AlertTriangle, Wand2 } from 'lucide-react';
import { AddToDashboard } from '../components/AddToDashboard';
import { RichText } from '../components/RichText';
import { VizCard } from '../components/VizCard';
import { Button, EmptyState, ErrorNote, IconButton, Spinner, TextArea } from '../components/ui';
import { useData } from '../lib/DataContext';
import { useMoca } from '../lib/MocaProvider';
import { formatDateTime, newLocalId } from '../lib/format';
import { PROVIDER_LABELS, type ChatMessage, type Conversation, type ConversationMeta, type RunEvent, type StreamEvent, type VizSpec } from '../shared/types';

/** Chat con i dati: storico, avanzamento in tempo reale, grafici nella risposta. */

const EVENT_ICON: Record<RunEvent['kind'], typeof Database> = {
  thinking: Brain,
  mcp: Server,
  cache: Database,
  query: Database,
  dataset: CheckCircle2,
  viz: CheckCircle2,
  blocked: ShieldAlert,
  error: AlertTriangle,
  info: Bot,
};

const SUGGESTIONS = [
  'Com\'è andato il traffico del sito negli ultimi 30 giorni, per canale?',
  'Quali campagne Meta hanno il ROAS migliore questo mese?',
  'Confronta la spesa pubblicitaria con le sessioni del sito, settimana per settimana',
  'Quali query di Search Console hanno molte impression ma CTR basso?',
];

function Events({ events, live }: { events: RunEvent[]; live?: boolean }) {
  const [open, setOpen] = useState(!!live);
  if (!events.length) return null;
  const fromCache = events.filter((e) => e.kind === 'cache' || e.kind === 'query').length;
  const calls = events.filter((e) => e.kind === 'mcp').length;
  return (
    <div className="mt-3">
      {!live && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xs text-moca-gray hover:text-moca-black">
          <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
          {events.length} passaggi · {calls} chiamate ai server · {fromCache} dalla cache
        </button>
      )}
      {(open || live) && (
        <ol className="mt-2 space-y-1.5 border-l-2 border-moca-line pl-3">
          {events.map((e, i) => {
            const Icon = EVENT_ICON[e.kind] ?? Bot;
            const tone = e.kind === 'blocked' || e.kind === 'error' ? 'text-moca-red' : e.kind === 'cache' || e.kind === 'query' ? 'text-chart-green' : 'text-moca-text';
            return (
              <li key={i} className={`flex items-start gap-2 text-xs ${tone}`}>
                <Icon size={14} className="mt-0.5 shrink-0" />
                <span>{e.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Message({ m, onAdd }: { m: ChatMessage; onAdd: (v: VizSpec) => void }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-moca-black text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
          {m.text}
          <p className="text-[10px] text-gray-400 mt-1 text-right">
            {m.author} · {formatDateTime(m.at)}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-3">
      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${m.error ? 'bg-danger/10 text-danger' : 'bg-moca-red-light text-moca-red'}`}>
        {m.error ? <AlertTriangle size={16} /> : <Wand2 size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="bg-white rounded-2xl rounded-tl-sm shadow-card px-4 py-3">
          <RichText text={m.text} />
          <Events events={m.events ?? []} />
          <p className="text-[10px] text-moca-gray mt-2">
            {m.provider ? PROVIDER_LABELS[m.provider] : 'Assistente'} · {formatDateTime(m.at)}
          </p>
        </div>
        {!!m.vizs?.length && (
          <div className={`grid gap-4 mt-3 ${m.vizs.length > 1 ? 'xl:grid-cols-2' : ''}`}>
            {m.vizs.map((v) => (
              <VizCard
                key={v.id}
                spec={v}
                height={220}
                actions={
                  <IconButton label="Aggiungi alla dashboard" onClick={() => onAdd(v)}>
                    <LayoutDashboard size={16} />
                  </IconButton>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface Live {
  runId?: string;
  conversationId?: string;
  events: RunEvent[];
  text: string;
  vizs: VizSpec[];
  abort?: AbortController;
}

export function ChatView({ initialText, onInitialUsed }: { initialText?: string | null; onInitialUsed?: () => void } = {}) {
  const { info } = useMoca();
  const { api, refreshDatasets } = useData();
  const [list, setList] = useState<ConversationMeta[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [text, setText] = useState('');
  const [refresh, setRefresh] = useState(false);
  const [running, setRunning] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<VizSpec | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const streaming = !!info.streaming;

  // Richiesta preparata altrove (es. "Rendi filtrabile" in dashboard): nuova conversazione, testo pronto da inviare.
  useEffect(() => {
    if (!initialText) return;
    setConv(null);
    setText(initialText);
    onInitialUsed?.();
    window.setTimeout(() => input.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  const loadList = useCallback(() => api.listConversations().then(setList).catch(() => undefined), [api]);
  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [conv?.messages.length, running?.events.length, running?.vizs.length, running?.text.length]);

  const finish = useCallback(
    (message: ChatMessage | null) => {
      if (message) setConv((c) => (c ? { ...c, messages: [...c.messages, message] } : c));
      setRunning(null);
      refreshDatasets();
      loadList();
    },
    [refreshDatasets, loadList],
  );

  // Flusso con polling (Netlify Functions): avanzamento finché la risposta non è pronta.
  useEffect(() => {
    if (!running?.runId || streaming) return;
    let after = running.events.length;
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const s = await api.runStatus(running.runId!, after);
        after = s.total;
        if (s.events.length) setRunning((r) => (r ? { ...r, events: [...r.events, ...s.events] } : r));
        if (s.status === 'done' || s.status === 'error') return finish(s.message);
        if (Date.now() - started > 16 * 60 * 1000) {
          setError('La risposta sta impiegando troppo tempo. Riapri la conversazione tra qualche minuto.');
          setRunning(null);
          return;
        }
      } catch (e) {
        setError((e as Error).message);
      }
      timer = window.setTimeout(tick, 1500);
    };
    let timer = window.setTimeout(tick, 900);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running?.runId, streaming]);

  const open = async (id: string) => {
    if (running) return;
    setError(null);
    try {
      setConv(await api.getConversation(id));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addUserMessage = (conversationId: string, q: string) => {
    const userMsg: ChatMessage = { id: newLocalId(), role: 'user', text: q, at: new Date().toISOString(), author: 'Tu' };
    setConv((c) =>
      c && c.id === conversationId
        ? { ...c, messages: [...c.messages, userMsg] }
        : { id: conversationId, title: q.slice(0, 70), createdAt: userMsg.at, updatedAt: userMsg.at, createdBy: 'Tu', messageCount: 1, messages: [userMsg] },
    );
  };

  const onStreamEvent = (q: string) => (e: StreamEvent) => {
    switch (e.type) {
      case 'start':
        addUserMessage(e.conversationId, q);
        setRunning((r) => (r ? { ...r, conversationId: e.conversationId } : r));
        break;
      case 'step':
        setRunning((r) => (r ? { ...r, events: [...r.events, e.event] } : r));
        break;
      case 'turn':
        // Il testo scritto prima di usare gli strumenti diventa un passaggio.
        setRunning((r) =>
          r && r.text.trim() ? { ...r, text: '', events: [...r.events, { at: new Date().toISOString(), kind: 'info', text: r.text.trim().slice(0, 200) }] } : r,
        );
        break;
      case 'text':
        setRunning((r) => (r ? { ...r, text: r.text + e.delta } : r));
        break;
      case 'viz':
        setRunning((r) => (r ? { ...r, vizs: [...r.vizs, e.spec] } : r));
        break;
      case 'done':
        finish(e.message);
        break;
      case 'error':
        setError(e.error);
        setRunning(null);
        break;
    }
  };

  const send = async (question?: string) => {
    const q = (question ?? text).trim();
    if (!q || running) return;
    setError(null);
    setText('');
    setRefresh(false);
    if (streaming) {
      const abort = new AbortController();
      setRunning({ events: [], text: '', vizs: [], abort });
      try {
        await api.chatStream({ conversationId: conv?.id, message: q, refresh }, onStreamEvent(q), abort.signal);
      } catch (e) {
        setError((e as Error).message);
        setText(q);
        setRunning(null);
      }
      // Flusso chiuso senza "done" (connessione caduta): si ricarica la conversazione salvata.
      setRunning((r) => (r && !abort.signal.aborted ? null : r));
      return;
    }
    try {
      const { runId, conversationId } = await api.chatStart({ conversationId: conv?.id, message: q, refresh });
      addUserMessage(conversationId, q);
      setRunning({ runId, conversationId, events: [], text: '', vizs: [] });
    } catch (e) {
      setError((e as Error).message);
      setText(q);
    }
  };

  const stop = async () => {
    if (!running) return;
    const convId = running.conversationId ?? conv?.id;
    if (running.abort) running.abort.abort();
    else if (running.runId) await api.cancelRun(running.runId).catch(() => undefined);
    if (running.abort) {
      setRunning(null);
      // Il server salva la risposta interrotta: la si rilegge dopo un attimo.
      window.setTimeout(() => {
        if (convId) api.getConversation(convId).then(setConv).catch(() => undefined);
        refreshDatasets();
        loadList();
      }, 1200);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Eliminare questa conversazione?')) return;
    try {
      await api.deleteConversation(id);
      if (conv?.id === id) setConv(null);
      loadList();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const disabledReason = !info.scope ? 'Perimetro del cliente non configurato.' : !info.providers.length ? "Nessuna chiave Anthropic configurata per questo cliente nell'Hub." : null;

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-6">
      <aside className="space-y-2">
        <Button className="w-full" onClick={() => !running && setConv(null)} disabled={!!running}>
          <MessageSquarePlus size={16} /> Nuova conversazione
        </Button>
        <nav className="bg-white rounded-xl shadow-card p-2 space-y-1 max-h-[65vh] overflow-y-auto scrollbar-thin">
          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-moca-gray">Storico</p>
          {!list.length && <p className="text-xs text-moca-gray px-2 pb-2">Le conversazioni restano salvate qui, condivise con chi lavora su questo cliente.</p>}
          {list.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-md border ${conv?.id === c.id ? 'bg-moca-red-light border-moca-red' : 'border-transparent hover:bg-gray-100'}`}>
              <button type="button" onClick={() => open(c.id)} className="flex-1 min-w-0 text-left px-3 py-2">
                <span className={`block text-sm truncate ${conv?.id === c.id ? 'text-moca-red font-medium' : 'text-moca-black'}`}>{c.title}</span>
                <span className="block text-[11px] text-moca-gray">
                  {c.createdBy} · {formatDateTime(c.updatedAt)}
                </span>
              </button>
              <IconButton label="Elimina conversazione" className="opacity-0 group-hover:opacity-100 mr-1" onClick={() => remove(c.id)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex flex-col bg-moca-bg">
        <div className="flex-1 space-y-5 pb-4">
          {!conv?.messages.length && !running && (
            <div className="bg-white rounded-xl shadow-card">
              <EmptyState
                icon={<Sparkles size={22} />}
                title="Chiedi ai dati del cliente"
                text="L'assistente legge solo gli account del cliente presenti nel Data Lake, salva i dati come dataset e crea i grafici. Se i dati sono già stati letti, li riusa senza nuove chiamate ai server."
                action={
                  <div className="grid sm:grid-cols-2 gap-2 max-w-2xl text-left">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" disabled={!!disabledReason} onClick={() => send(s)} className="rounded-lg border border-moca-line px-3 py-2 text-xs text-moca-text hover:border-moca-red hover:text-moca-black transition disabled:opacity-50">
                        {s}
                      </button>
                    ))}
                  </div>
                }
              />
            </div>
          )}
          {conv?.messages.map((m) => <Message key={m.id} m={m} onAdd={setAdding} />)}
          {running && (
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-moca-red-light text-moca-red flex items-center justify-center shrink-0">
                <Spinner size={4} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="bg-white rounded-2xl rounded-tl-sm shadow-card px-4 py-3">
                  {running.text ? <RichText text={running.text} /> : <p className="text-sm text-moca-black font-medium">Sto preparando la risposta</p>}
                  <Events events={running.events} live />
                </div>
                {!!running.vizs.length && (
                  <div className={`grid gap-4 mt-3 ${running.vizs.length > 1 ? 'xl:grid-cols-2' : ''}`}>
                    {running.vizs.map((v) => (
                      <VizCard key={v.id} spec={v} height={220} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        <div className="sticky bottom-0 pt-2 pb-1 bg-moca-bg">
          {error && (
            <div className="mb-2">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}
          {disabledReason && (
            <div className="mb-2">
              <ErrorNote>{disabledReason}</ErrorNote>
            </div>
          )}
          <div className="bg-white rounded-xl shadow-card p-3">
            <TextArea
              ref={input}
              rows={text.length > 160 ? 4 : 2}
              value={text}
              maxLength={4000}
              disabled={!!disabledReason}
              placeholder="Es. Mostrami l'andamento delle conversioni GA4 per canale negli ultimi 90 giorni"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              className="!border-0 !ring-0 !px-1 resize-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <label className="flex items-center gap-1.5 text-xs text-moca-text cursor-pointer select-none" title="Ignora la cache e rilegge i dati dai server">
                <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} className="accent-moca-red" />
                <RefreshCw size={12} /> Rileggi i dati dai server
              </label>
              {running ? (
                <Button variant="secondary" onClick={stop}>
                  <Square size={14} /> Interrompi
                </Button>
              ) : (
                <Button onClick={() => send()} disabled={!text.trim() || !!disabledReason}>
                  <Send size={16} /> Invia
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      {adding && <AddToDashboard spec={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}
