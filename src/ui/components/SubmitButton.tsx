'use client'
import { useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { usePathname, useSearchParams } from 'next/navigation'
import { Button } from './Button'
import type { ButtonProps } from './Button'

/** Passado esse tempo, uma navegação que não terminou deixa o botão livre de novo (rede caiu, mesma busca repetida). */
const LIMITE_MS = 10_000

/**
 * Botão de envio que espera junto com o formulário: desabilita, mostra o anel e diz "Aguarde…" até a resposta chegar.
 * Cobre três tipos de formulário: com server action (`useFormStatus`), com POST nativo (a página inteira troca) e com
 * `next/form` de busca (navegação do cliente, que acaba quando a URL muda). A espera começa depois do envio ser montado,
 * então o `name`/`value` do botão que enviou (`intent=remove`) segue no corpo da requisição.
 */
export function SubmitButton(props: Omit<ButtonProps, 'loading' | 'type'>) {
  const { pending } = useFormStatus()
  // O endereço em que o envio começou: a espera acaba sozinha quando o endereço muda (navegação do cliente terminou).
  const [enviadoEm, setEnviadoEm] = useState<string | null>(null)
  const ref = useRef<HTMLButtonElement>(null)
  const pathname = usePathname()
  const aqui = `${pathname}?${useSearchParams()?.toString() ?? ''}`
  const aquiRef = useRef(aqui)
  const enviando = enviadoEm === aqui

  useEffect(() => {
    aquiRef.current = aqui
  })

  useEffect(() => {
    const form = ref.current?.form
    if (!form) return
    let temporizador: ReturnType<typeof setTimeout> | undefined
    const aoEnviar = (e: SubmitEvent) => {
      if (e.submitter !== null && e.submitter !== ref.current) return
      // Adia: o formulário nativo monta o corpo logo depois do evento, e a decisão precisa ver o que o React já fez.
      setTimeout(() => {
        const acao = form.getAttribute('action') ?? ''
        const serverAction = e.defaultPrevented && acao.startsWith('javascript:')
        if (serverAction) return
        setEnviadoEm(aquiRef.current)
        clearTimeout(temporizador)
        temporizador = setTimeout(() => setEnviadoEm(null), LIMITE_MS)
      }, 0)
    }
    // Voltar pelo histórico traz a página do cache com o botão ainda esperando.
    const aoVoltar = () => setEnviadoEm(null)
    form.addEventListener('submit', aoEnviar)
    window.addEventListener('pageshow', aoVoltar)
    return () => {
      form.removeEventListener('submit', aoEnviar)
      window.removeEventListener('pageshow', aoVoltar)
      clearTimeout(temporizador)
    }
  }, [])

  return <Button {...props} ref={ref} type="submit" loading={pending || enviando} />
}
