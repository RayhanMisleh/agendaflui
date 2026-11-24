'use client'
import { useEffect, useRef } from 'react'
import { CircleAlert } from 'lucide-react'
import { useToast } from '@/ui/components'
import type { EstadoConta } from '../_lib/estado'

/**
 * O que a ação devolveu: o sucesso vira aviso flutuante (uma vez por resposta) e o erro fica na tela, em `role="alert"`,
 * com o que fazer. Erros de campo aparecem junto do campo; aqui entra só a mensagem geral.
 */
export function Retorno({ state }: { state: EstadoConta }) {
  const toast = useToast()
  const avisado = useRef<EstadoConta | null>(null)
  useEffect(() => {
    if (state.ok && state.message && avisado.current !== state) {
      avisado.current = state
      toast({ tone: 'success', message: state.message })
    }
  }, [state, toast])
  if (state.ok || !state.message) return null
  return (
    <p role="alert" className="af-conta__alert">
      <CircleAlert size={18} aria-hidden="true" />
      <span>{state.message}</span>
    </p>
  )
}
