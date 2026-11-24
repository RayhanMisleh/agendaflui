import type { CSSProperties } from 'react'
import { PX_PER_MIN } from './metrics'
import type { MovePreview } from './use-drag-reschedule'

/** A prévia de onde a ficha vai cair, já encaixada na grade. É o que flutua: leva a sombra; só aparece enquanto se move. */
export function DropPreview({ preview, windowStartMin, customerName }: { preview: MovePreview; windowStartMin: number; customerName: string }) {
  return (
    <div
      aria-hidden="true"
      className="af-slip af-slip--dragging af-planner__preview"
      style={{ '--y': `${(preview.startMin - windowStartMin) * PX_PER_MIN}px`, height: `${preview.heightMin * PX_PER_MIN}px`, '--lane': '0', '--lanes': '1' } as CSSProperties}
    >
      <span className="af-slip__name">{customerName}</span>
      <span className="af-slip__time">{preview.label}</span>
    </div>
  )
}
