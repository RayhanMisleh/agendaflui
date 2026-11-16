'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from './Button'

/** Copia o texto para a área de transferência (com plano B para páginas sem contexto seguro) e avisa em texto. */
async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    // cai no plano B
  }
  try {
    const area = document.createElement('textarea')
    area.value = texto
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export function CopyButton({ text, label, variant = 'secondary' }: { text: string; label: string; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const [estado, setEstado] = useState<'parado' | 'copiado' | 'falhou'>('parado')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function onClick() {
    setEstado((await copiar(text)) ? 'copiado' : 'falhou')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setEstado('parado'), 2500)
  }

  return (
    <span className="af-copy">
      <Button variant={variant} size="sm" aria-label={label} onClick={onClick} icon={estado === 'copiado' ? <Check size={16} /> : <Copy size={16} />}>
        {estado === 'copiado' ? 'Copiado' : 'Copiar'}
      </Button>
      <span role="status" className="af-sr">
        {estado === 'copiado' ? 'Copiado para a área de transferência.' : estado === 'falhou' ? 'Não foi possível copiar. Selecione o texto e copie à mão.' : ''}
      </span>
    </span>
  )
}
