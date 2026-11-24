'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MENSAGEM_GENERICA } from '@/app/_lib/form-state'
import type { Pedido } from '../_lib/consulta'

/**
 * Lê uma consulta do servidor e devolve `null` enquanto carrega (o passo mostra o esqueleto no lugar da lista). Trocar `buscar`
 * (as escolhas mudaram) volta ao carregamento; `tentar` refaz a mesma consulta ("Tentar de novo"). Sessão que acabou
 * (`reentrar`) leva à entrada da loja.
 */
export function useConsulta<T extends object>(buscar: (() => Promise<Pedido<T>>) | null): { pedido: Pedido<T> | null; tentar: () => void } {
  const router = useRouter()
  const [tentativa, setTentativa] = useState(0)
  const [lido, setLido] = useState<{ de: unknown; tentativa: number; pedido: Pedido<T> } | null>(null)
  useEffect(() => {
    if (buscar === null) return
    let vivo = true
    buscar()
      .then((pedido) => vivo && setLido({ de: buscar, tentativa, pedido }))
      .catch(() => vivo && setLido({ de: buscar, tentativa, pedido: { ok: false, message: MENSAGEM_GENERICA, reentrar: null } }))
    return () => {
      vivo = false
    }
  }, [buscar, tentativa])
  const pedido = buscar !== null && lido !== null && lido.de === buscar && lido.tentativa === tentativa ? lido.pedido : null
  const reentrar = pedido && !pedido.ok ? pedido.reentrar : null
  useEffect(() => {
    if (reentrar) router.push(reentrar)
  }, [reentrar, router])
  return { pedido, tentar: () => setTentativa((n) => n + 1) }
}
