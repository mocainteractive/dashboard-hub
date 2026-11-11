import { forwardRef, useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

/** Componenti di base nello stile Moca Design System v2.0. */

export function Card({ title, subtitle, actions, children, className = '', padded = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`bg-white rounded-xl shadow-card ${padded ? 'p-5' : ''} ${className}`}>
      {(title || actions) && (
        <div className={`flex items-start justify-between gap-3 ${padded ? 'mb-4' : 'px-5 pt-5 mb-3'}`}>
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-moca-black uppercase tracking-wide truncate">{title}</h2>}
            {subtitle && <p className="text-xs text-moca-gray mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-medium text-moca-black uppercase tracking-wide">{title}</h1>
        {subtitle && <p className="text-sm text-moca-text mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ variant = 'primary', size = 'md', className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-moca-red text-white hover:opacity-90',
    secondary: 'bg-white text-moca-black border border-gray-300 hover:bg-gray-50',
    ghost: 'text-moca-text hover:bg-gray-100 hover:text-moca-black',
    danger: 'bg-white text-danger border border-danger/40 hover:bg-danger/5',
  };
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' };
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]} ${sizes[size]} ${className}`}
    />
  );
}

export function IconButton({ label, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className={`p-1.5 rounded-md text-moca-gray hover:text-moca-black hover:bg-gray-100 transition disabled:opacity-40 ${className}`}
    />
  );
}

const inputClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-moca-black placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-moca-red/40 focus:border-moca-red disabled:bg-gray-100';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(props, ref) {
  return <textarea ref={ref} {...props} className={`${inputClass} ${props.className ?? ''}`} />;
});

export function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-moca-black uppercase tracking-wide mb-1">{label}</span>
      {children}
      {help && <span className="block text-xs text-moca-gray mt-1">{help}</span>}
    </label>
  );
}

export function Spinner({ size = 6 }: { size?: number }) {
  return <div className="animate-spin border-2 border-moca-red border-t-transparent rounded-full" style={{ width: size * 4, height: size * 4 }} />;
}

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'red' | 'green' | 'blue' | 'amber'; children: ReactNode }) {
  const tones = {
    gray: 'bg-gray-100 text-moca-text',
    red: 'bg-moca-red-light text-moca-red',
    green: 'bg-success/10 text-green-700',
    blue: 'bg-chart-blue/10 text-chart-blue',
    amber: 'bg-warning/10 text-amber-700',
  };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="h-12 w-12 rounded-full bg-moca-bg flex items-center justify-center text-moca-black mb-4">{icon}</div>
      <h3 className="text-sm font-semibold text-moca-black uppercase tracking-wide">{title}</h3>
      {text && <p className="text-sm text-moca-text mt-2 max-w-md">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-moca-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-5xl' : 'max-w-lg'} max-h-[92vh] flex flex-col`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-moca-line">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-moca-black">{title}</h2>
          <IconButton label="Chiudi" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="p-5 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-moca-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-red-700">{children}</div>;
}
