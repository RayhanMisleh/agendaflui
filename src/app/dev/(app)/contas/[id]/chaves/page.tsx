import type { Metadata } from 'next'
import { listApiKeys } from '@/server/domain/platform/api-keys'
import { usageByKey } from '@/server/domain/platform/api-usage'
import { addMinutes } from '@/server/time'
import { HorariosNota } from '../../../_lib/HorariosNota'
import { quando } from '../../../_lib/format'
import { carregarConta } from '../_data'
import { criarChave, editarOrigens, revogarChave } from '../actions'
import { KeysPanel } from '../KeysPanel'

export const metadata: Metadata = { title: 'Chaves da conta | Agenda Flui' }

export default async function ChavesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const agora = new Date()
  const desde = addMinutes(agora, -7 * 24 * 60)
  const chaves = await listApiKeys(admin, { businessId: conta.id })
  // Uma consulta para todas as chaves da conta, não uma por chave.
  const uso = await usageByKey(admin, { from: desde, to: agora, apiKeyIds: chaves.map((k) => k.id) })
  const dados = chaves.map((k) => {
    const linhas = uso.get(k.id) ?? []
    const requests = linhas.reduce((s, r) => s + r.count, 0)
    const ms = linhas.reduce((s, r) => s + r.avgMs * r.count, 0)
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      origins: k.allowedOrigins,
      revoked: k.revokedAt !== null,
      createdAt: quando(k.createdAt),
      lastUsed: k.lastUsedAt ? quando(k.lastUsedAt) : null,
      usage: {
        requests,
        errors: linhas.reduce((s, r) => s + r.errorCount, 0),
        avgMs: requests === 0 ? 0 : Math.round(ms / requests),
        routes: [...linhas].sort((a, b) => b.count - a.count).slice(0, 5).map((r) => ({ route: r.route, count: r.count })),
      },
    }
  })
  return (
    <>
      <HorariosNota />
      <KeysPanel chaves={dados} acoes={{ criarChave: criarChave.bind(null, conta.id), editarOrigens: editarOrigens.bind(null, conta.id), revogarChave: revogarChave.bind(null, conta.id) }} />
    </>
  )
}
