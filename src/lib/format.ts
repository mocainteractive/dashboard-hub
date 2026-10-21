import type { Cell, Column } from '../shared/types';

/**
 * Formattazione all'italiana e palette dei grafici Moca.
 *
 * Palette categoriale validata (luminosità, croma, separazione per
 * daltonismo, contrasto): Rosso, Blu, Verde, Viola, Arancione nell'ordine
 * fisso; il grigio è riservato alla serie "Altro".
 */
export const SERIES_COLORS = ['#E52217', '#5781FF', '#118541', '#551FC4', '#DB5E29'];
export const OTHER_COLOR = '#484848';
export const GRID_COLOR = '#ECEDEF';
export const AXIS_TEXT = '#8A8A8A';

export function seriesColor(i: number, key?: string): string {
  if (key === 'Altro') return OTHER_COLOR;
  return SERIES_COLORS[i % SERIES_COLORS.length];
}

const nf = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat('it-IT', opts);

export function formatValue(v: Cell, col?: Pick<Column, 'format'>, currency = 'EUR', compact = false): string {
  if (v === null || v === undefined || v === '') return 'n.d.';
  if (typeof v === 'string' && Number.isNaN(Number(v))) return v;
  const n = Number(v);
  // In italiano la notazione compatta abbrevia solo da un milione in su.
  const c = compact && Math.abs(n) >= 1_000_000 ? { notation: 'compact' as const, maximumFractionDigits: 1 } : {};
  const whole = Number.isInteger(n) || Math.abs(n) >= 1000 || (compact && Math.abs(n) >= 100);
  switch (col?.format) {
    case 'currency':
      return nf({ style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2, ...c }).format(n);
    case 'percent':
      return `${nf({ maximumFractionDigits: 2 }).format(n)}%`;
    case 'decimal':
      return nf({ maximumFractionDigits: compact && Math.abs(n) >= 100 ? 0 : 2, ...c }).format(n);
    case 'duration': {
      const s = Math.round(n);
      return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
    }
    default:
      return nf({ maximumFractionDigits: Number.isInteger(n) || (compact && Math.abs(n) >= 100) ? 0 : 2, ...c }).format(n);
  }
}

const MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

/** "2026-10-03" -> "3 ott", "2026-10" -> "ott 2026". */
export function formatDateLabel(v: Cell): string {
  if (typeof v !== 'string') return String(v ?? '');
  const m = v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return v;
  const month = MONTHS[Number(m[2]) - 1] ?? m[2];
  return m[3] ? `${Number(m[3])} ${month}` : `${month} ${m[1]}`;
}

export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function newLocalId(): string {
  return (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-z0-9]/gi, '').slice(0, 20);
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
