import { useMemo, type ReactNode, type RefObject } from 'react';
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { DRAG_CLASS, layoutFor, MARGIN, ROW_HEIGHT } from '../lib/grid';
import { GRID_COLS, type DashboardWidget, type WidgetLayout } from '../shared/types';

/**
 * Griglia libera della dashboard (12 colonne): i widget si spostano
 * trascinandoli dal titolo o dalla maniglia, si affiancano e si
 * ridimensionano dall'angolo o dai bordi. Su schermi stretti i widget
 * si impilano nell'ordine della griglia.
 */

const MOBILE_MAX = 768;

const pxHeight = (h: number) => h * ROW_HEIGHT + (h - 1) * MARGIN;

export function WidgetGrid({
  widgets,
  onLayoutCommit,
  children,
}: {
  widgets: DashboardWidget[];
  /** Nuove posizioni dopo uno spostamento o un ridimensionamento. */
  onLayoutCommit: (layouts: Record<string, WidgetLayout>) => void;
  children: (w: DashboardWidget) => ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  const layout = useMemo(() => layoutFor(widgets), [widgets]);

  const commit = (l: Layout) => onLayoutCommit(Object.fromEntries(l.map((it) => [it.i, { x: it.x, y: it.y, w: it.w, h: it.h }])));

  const ordered = useMemo(() => {
    const pos = new Map(layout.map((l) => [l.i, l]));
    return [...widgets].sort((a, b) => {
      const pa = pos.get(a.id)!;
      const pb = pos.get(b.id)!;
      return pa.y - pb.y || pa.x - pb.x;
    });
  }, [widgets, layout]);

  return (
    <div ref={containerRef as RefObject<HTMLDivElement>}>
      {mounted &&
        (width >= MOBILE_MAX ? (
          <ReactGridLayout
            width={width}
            layout={layout}
            gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT, margin: [MARGIN, MARGIN], containerPadding: [0, 0] }}
            dragConfig={{ enabled: true, handle: `.${DRAG_CLASS}`, threshold: 4 }}
            resizeConfig={{ enabled: true, handles: ['se', 'e', 's'] }}
            compactor={verticalCompactor}
            onDragStop={commit}
            onResizeStop={commit}
          >
            {widgets.map((w) => (
              <div key={w.id} className="min-w-0">
                {children(w)}
              </div>
            ))}
          </ReactGridLayout>
        ) : (
          <div className="space-y-5">
            {ordered.map((w) => (
              <div key={w.id} style={{ height: pxHeight(layout.find((l) => l.i === w.id)!.h) }}>
                {children(w)}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
