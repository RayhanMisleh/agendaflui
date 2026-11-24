'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Share2 } from 'lucide-react'
import { Button } from './Button'
import type { ButtonProps } from './Button'
import { copiarTexto } from './CopyButton'

/**
 * "Compartilhar": abre a folha de compartilhar do aparelho (`navigator.share`) e, onde ela não existe, copia o link e diz
 * "Link copiado." em texto (que o leitor de tela também lê). Fechar a folha sem compartilhar não é erro e não mostra nada.
 */
export function ShareButton({
  url,
  title,
  text,
  variant = 'secondary',
  size = 'md',
}: {
  url: string
  title?: string
  text?: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
}) {
  const [aviso, setAviso] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function avisar(mensagem: string, copiou: boolean) {
    setAviso(mensagem)
    setCopiado(copiou)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setAviso(null)
      setCopiado(false)
    }, 2500)
  }

  async function compartilhar() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, ...(title ? { title } : {}), ...(text ? { text } : {}) })
        return
      } catch (err) {
        // Fechar a folha sem escolher ninguém não é erro; qualquer outra falha cai no plano B (copiar).
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    if (await copiarTexto(url)) avisar('Link copiado.', true)
    else avisar('Não foi possível copiar. Selecione o link e copie à mão.', false)
  }

  return (
    <span className="af-share">
      <Button variant={variant} size={size} onClick={() => void compartilhar()} icon={copiado ? <Check size={16} /> : <Share2 size={16} />}>
        Compartilhar
      </Button>
      <span role="status" className={aviso ? 'af-share__note' : 'af-sr'}>
        {aviso ?? ''}
      </span>
    </span>
  )
}
