import { useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ClipboardEvent, FormEvent, ReactElement } from 'react';

/**
 * Widget di feedback autonomo (solo email).
 *
 * Portato dal Moca Central Hub e reso self-contained: non dipende da
 * lucide-react, dal design system Tailwind (moca-*) o dall'SDK Moca, così
 * da poter essere incollato identico in ogni app satellite. Invia il
 * feedback alla Netlify Function `send-feedback`, che inoltra l'email al team.
 */

type FeedbackType = 'bug' | 'suggestion' | 'question' | 'other';
type Severity = 'low' | 'medium' | 'high' | 'blocker';

interface FeedbackWidgetProps {
  currentPage?: string;
}

interface Screenshot {
  name: string;
  dataUrl: string;
  size: number;
}

const BRAND = '#E52217';
const BRAND_LIGHT = '#FDECEA';

const MAX_SCREENSHOTS = 4;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB prima della compressione
const MAX_DIMENSION = 1600; // px — gli screenshot vengono ridimensionati prima dell'invio

// Ridimensiona + ricodifica le immagini lato client così il corpo della
// richiesta resta ben sotto il limite di payload di Netlify anche con più
// screenshot allegati.
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const scale = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(reader.result as string); return; }
        ctx.drawImage(img, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch {
          resolve(reader.result as string);
        }
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- Icone SVG inline (nessuna dipendenza esterna) ---
type IconProps = { size?: number; className?: string; style?: CSSProperties };

const MessageIcon = ({ size = 20, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><line x1="12" y1="7" x2="12" y2="13" /><line x1="9" y1="10" x2="15" y2="10" />
  </svg>
);
const XIcon = ({ size = 18, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const BugIcon = ({ size = 16, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <rect x="8" y="6" width="8" height="14" rx="4" /><path d="m19 7-3 2" /><path d="m5 7 3 2" /><path d="M19 19l-3-2" /><path d="m5 19 3-2" /><path d="M20 13h-4" /><path d="M4 13h4" /><path d="m10 4 1 2" /><path d="m14 4-1 2" />
  </svg>
);
const LightbulbIcon = ({ size = 16, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M9 18h6" /><path d="M10 22h4" /><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
  </svg>
);
const QuestionIcon = ({ size = 16, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);
const MoreIcon = ({ size = 16, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />
  </svg>
);
const UploadIcon = ({ size = 20, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const LoaderIcon = ({ size = 18, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" /><line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" /><line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" /><line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </svg>
);
const CheckIcon = ({ size = 40, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);
const ImageIcon = ({ size = 12, className, style }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
);

const TYPE_OPTIONS: { value: FeedbackType; label: string; Icon: (p: IconProps) => ReactElement }[] = [
  { value: 'bug', label: 'Problema', Icon: BugIcon },
  { value: 'suggestion', label: 'Suggerimento', Icon: LightbulbIcon },
  { value: 'question', label: 'Domanda', Icon: QuestionIcon },
  { value: 'other', label: 'Altro', Icon: MoreIcon },
];

const SEVERITY_OPTIONS: { value: Severity; label: string; color: string }[] = [
  { value: 'low', label: 'Bassa', color: 'text-green-700 border-green-300 bg-green-50' },
  { value: 'medium', label: 'Media', color: 'text-yellow-700 border-yellow-300 bg-yellow-50' },
  { value: 'high', label: 'Alta', color: 'text-orange-700 border-orange-300 bg-orange-50' },
  { value: 'blocker', label: 'Bloccante', color: 'text-red-700 border-red-300 bg-red-50' },
];

export function FeedbackWidget({ currentPage }: FeedbackWidgetProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('bug');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(currentPage || '');
  const [contactEmail, setContactEmail] = useState('');
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setType('bug');
    setSeverity('medium');
    setTitle('');
    setMessage('');
    setScreenshots([]);
    setError(null);
    setSubmitted(false);
  };

  const openPanel = () => {
    setPage(currentPage || '');
    setOpen(true);
  };

  const closePanel = () => {
    setOpen(false);
    setTimeout(resetForm, 200);
  };

  const addFiles = async (files: FileList | File[]) => {
    setError(null);
    const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (incoming.length === 0) {
      setError('Trascina solo immagini (PNG, JPG, ...).');
      return;
    }

    const next: Screenshot[] = [];
    for (const file of incoming) {
      if (screenshots.length + next.length >= MAX_SCREENSHOTS) {
        setError(`Puoi allegare al massimo ${MAX_SCREENSHOTS} immagini.`);
        break;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(`"${file.name}" supera i 10MB.`);
        continue;
      }
      try {
        const dataUrl = await compressImage(file);
        next.push({ name: file.name, dataUrl, size: file.size });
      } catch {
        setError('Impossibile leggere un\'immagine.');
      }
    }
    if (next.length > 0) setScreenshots((prev) => [...prev, ...next]);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.files;
    if (items && items.length) addFiles(items);
  };

  const removeScreenshot = (idx: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError('Descrivi il problema o il suggerimento.');
      return;
    }
    if (!contactEmail.trim()) {
      setError('Inserisci un\'email per il ricontatto.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      setError('Inserisci un indirizzo email valido.');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const resp = await fetch('/.netlify/functions/send-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          severity: type === 'bug' ? severity : undefined,
          title: title.trim() || undefined,
          message: message.trim(),
          page: page.trim() || undefined,
          contact_email: contactEmail.trim() || undefined,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
          screenshots: screenshots.map((s) => ({ name: s.name, dataUrl: s.dataUrl })),
        }),
      });

      const result = await resp.json().catch(() => ({}));
      setSubmitting(false);
      if (!resp.ok) {
        setError(result.error || 'Invio non riuscito. Riprova.');
        return;
      }
      setSubmitted(true);
      setTimeout(closePanel, 2200);
    } catch {
      setSubmitting(false);
      setError('Errore di connessione. Riprova.');
    }
  };

  return (
    <>
      {/* Pulsante flottante */}
      {!open && (
        <button
          onClick={openPanel}
          aria-label="Invia feedback"
          className="fixed bottom-5 right-5 z-[60] flex items-center space-x-2 text-white px-4 py-3 rounded-full shadow-lg hover:opacity-90 transition-opacity"
          style={{ backgroundColor: BRAND }}
        >
          <MessageIcon size={20} />
          <span className="hidden sm:inline font-medium">Feedback</span>
        </button>
      )}

      {/* Pannello */}
      {open && (
        <div className="fixed bottom-5 right-5 z-[60] w-[calc(100vw-2.5rem)] sm:w-96 max-h-[85vh] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ backgroundColor: '#1a1a1a' }}>
            <div className="flex items-center space-x-2">
              <MessageIcon size={18} />
              <h3 className="font-semibold text-sm">Invia un feedback</h3>
            </div>
            <button onClick={closePanel} aria-label="Chiudi" className="p-1 hover:bg-white/10 rounded-md">
              <XIcon size={18} />
            </button>
          </div>

          {submitted ? (
            <div className="flex flex-col items-center justify-center text-center px-6 py-10 space-y-3">
              <CheckIcon size={40} className="text-green-500" />
              <p className="font-semibold text-gray-900">Grazie!</p>
              <p className="text-sm text-gray-500">Il tuo feedback è stato inviato al team.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} onPaste={handlePaste} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
              {/* Tipo */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Di cosa si tratta?</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {TYPE_OPTIONS.map((opt) => {
                    const Icon = opt.Icon;
                    const active = type === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setType(opt.value)}
                        className="flex flex-col items-center justify-center gap-1 py-2 rounded-md border text-xs transition-colors"
                        style={active
                          ? { borderColor: BRAND, backgroundColor: BRAND_LIGHT, color: BRAND }
                          : { borderColor: '#e5e7eb', color: '#6b7280' }}
                      >
                        <Icon size={16} />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Gravità (solo per i bug) */}
              {type === 'bug' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Quanto è grave?</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {SEVERITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setSeverity(opt.value)}
                        className={`py-1.5 rounded-md border text-xs font-medium transition-colors ${
                          severity === opt.value ? opt.color : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Titolo */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Titolo (facoltativo)</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={type === 'bug' ? 'Es. Non riesco a generare il risultato' : 'Riassumi in poche parole'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>

              {/* Messaggio */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  {type === 'bug' ? 'Cosa è successo? Cosa ti aspettavi?' : 'Raccontaci di più'} *
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder={
                    type === 'bug'
                      ? 'Descrivi i passaggi per riprodurre il problema, cosa è successo e cosa ti aspettavi.'
                      : 'Scrivi qui il tuo messaggio...'
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                  required
                />
              </div>

              {/* Pagina */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Pagina / sezione</label>
                <input
                  type="text"
                  value={page}
                  onChange={(e) => setPage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>

              {/* Screenshot drag & drop */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Screenshot (trascina, incolla o seleziona)
                </label>
                <div
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragging(false); }}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors"
                  style={dragging ? { borderColor: BRAND, backgroundColor: BRAND_LIGHT } : { borderColor: '#d1d5db' }}
                >
                  <UploadIcon size={20} className="mx-auto mb-1" style={{ color: dragging ? BRAND : '#6b7280' }} />
                  <p className="text-xs text-gray-500">
                    {dragging ? 'Rilascia qui...' : 'Trascina le immagini qui o clicca per selezionarle'}
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                  />
                </div>

                {screenshots.length > 0 && (
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {screenshots.map((s, idx) => (
                      <div key={idx} className="relative group">
                        <img src={s.dataUrl} alt={s.name} className="w-full h-14 object-cover rounded-md border border-gray-200" />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeScreenshot(idx); }}
                          className="absolute -top-1.5 -right-1.5 text-white rounded-full p-0.5 opacity-90 hover:opacity-100"
                          style={{ backgroundColor: '#1a1a1a' }}
                          aria-label="Rimuovi"
                        >
                          <XIcon size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {screenshots.length > 0 && (
                  <p className="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
                    <ImageIcon size={12} /> {screenshots.length}/{MAX_SCREENSHOTS} immagini allegate
                  </p>
                )}
              </div>

              {/* Email per ricontatto */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Email per ricontatto *</label>
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="tua.email@mocainteractive.com"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full text-white px-4 py-2.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center font-medium"
                style={{ backgroundColor: BRAND }}
              >
                {submitting ? <LoaderIcon size={18} className="animate-spin" /> : 'Invia feedback'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  );
}
