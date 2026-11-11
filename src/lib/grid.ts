import type { LayoutItem } from 'react-grid-layout';
import { GRID_COLS, type DashboardWidget } from '../shared/types';

/** Misure e layout predefinito della griglia della dashboard (12 colonne). */

export const ROW_HEIGHT = 30;
export const MARGIN = 16;
/** Larghezza iniziale (un terzo, due terzi, riga intera) in colonne della griglia. */
export const COLS_FOR_W: Record<1 | 2 | 3, number> = { 1: 4, 2: 8, 3: 12 };
export const DRAG_CLASS = 'widget-drag';

function defaultHeight(w: DashboardWidget): number {
  if (w.spec.type === 'kpi') return 5;
  if (w.spec.type === 'table') return 10;
  return 9;
}

/** Layout di tutti i widget: quelli senza posizione si accodano in fondo, riga per riga. */
export function layoutFor(widgets: DashboardWidget[]): LayoutItem[] {
  const out: LayoutItem[] = [];
  let bottom = 0;
  for (const w of widgets) {
    if (!w.layout) continue;
    out.push({ i: w.id, ...w.layout, minW: 2, minH: 3 });
    bottom = Math.max(bottom, w.layout.y + w.layout.h);
  }
  let x = 0;
  let y = bottom;
  let rowH = 0;
  for (const w of widgets) {
    if (w.layout) continue;
    const cols = COLS_FOR_W[w.w] ?? 8;
    const h = defaultHeight(w);
    if (x + cols > GRID_COLS) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    out.push({ i: w.id, x, y, w: cols, h, minW: 2, minH: 3 });
    x += cols;
    rowH = Math.max(rowH, h);
  }
  return out;
}
