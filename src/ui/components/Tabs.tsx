'use client'
import { useId, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { cx } from './cx'

export type TabItem = { id: string; label: string; href?: string }

/** Divisórias de fichário. Setas, Home e End navegam; a divisória ativa encosta no papel. */
export function Tabs({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem[]
  value: string
  onChange?: (id: string) => void
  label?: string
  className?: string
}) {
  const uid = useId()
  const refs = useRef<Record<string, HTMLElement | null>>({})

  function move(e: KeyboardEvent, from: number) {
    const last = items.length - 1
    let to = from
    if (e.key === 'ArrowRight') to = from === last ? 0 : from + 1
    else if (e.key === 'ArrowLeft') to = from === 0 ? last : from - 1
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = last
    else return
    e.preventDefault()
    const next = items[to]
    if (!next) return
    refs.current[next.id]?.focus()
    onChange?.(next.id)
  }

  return (
    <div role="tablist" aria-label={label} className={cx('af-tabs', className)}>
      {items.map((item, i) => {
        const selected = item.id === value
        const common = {
          role: 'tab' as const,
          id: `${uid}-${item.id}`,
          'aria-selected': selected,
          tabIndex: selected ? 0 : -1,
          className: cx('af-tab', selected && 'af-tab--active'),
          onKeyDown: (e: KeyboardEvent) => move(e, i),
          onClick: () => onChange?.(item.id),
        }
        return item.href ? (
          <a key={item.id} {...common} href={item.href} ref={(el) => { refs.current[item.id] = el }}>
            <span className="af-tab__label">{item.label}</span>
          </a>
        ) : (
          <button key={item.id} {...common} type="button" ref={(el) => { refs.current[item.id] = el }}>
            <span className="af-tab__label">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
