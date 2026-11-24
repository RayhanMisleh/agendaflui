import type { CSSProperties, ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from '@/ui/components'

/** Um passo do Agendar: título (que recebe o foco ao entrar), dica opcional e o conteúdo. */
export function Passo({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="af-cl-quiz__question" aria-labelledby={`passo-${id}`}>
      <h2 id={`passo-${id}`} tabIndex={-1} className="af-cl-quiz__title">
        {title}
      </h2>
      {hint ? <p className="af-cl-quiz__hint">{hint}</p> : null}
      {children}
    </section>
  )
}

/** O esqueleto de uma lista de cartões enquanto a consulta carrega. */
export function ListaCarregando({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="af-cl-flow__loading" role="status" aria-live="polite">
      <span className="af-sr">Carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <span key={i} aria-hidden="true" className="af-skel af-skel--card" style={{ '--h': '4.25rem' } as CSSProperties} />
      ))}
    </div>
  )
}

/** Falha de uma consulta: diz o que houve e oferece "Tentar de novo". */
export function ConsultaFalhou({ message, onTentar }: { message: string; onTentar: () => void }) {
  return (
    <div role="alert" className="af-cl-flow__failed">
      <p className="af-cl-quiz__error">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{message}</span>
      </p>
      <Button variant="secondary" onClick={onTentar}>
        Tentar de novo
      </Button>
    </div>
  )
}
