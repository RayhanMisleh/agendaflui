import type { Metadata } from 'next'
import { listApiKeys } from '@/server/domain/platform/api-keys'
import { usageSummary } from '@/server/domain/platform/api-usage'
import { addMinutes, formatDateTime } from '@/server/time'
import { carregarConta } from '../_data'
import { KeysPanel } from '../KeysPanel'

export const metadata: Metadata = { title: 'Chaves da conta | AgendaFlui' }

export default async function ChavesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  const agora = new Date()
  const desde = addMinutes(agora, -7 * 24 * 60)
  const chaves = await listApiKeys(admin, { businessId: conta.id })
  const dados = await Promise.all(
    chaves.map(async (k) => {
      const linhas = await usageSummary(admin, { from: desde, to: agora, apiKeyId: k.id })
      const requests = linhas.reduce((s, r) => s + r.count, 0)
      const ms = linhas.reduce((s, r) => s + r.avgMs * r.count, 0)
      return {
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        origins: k.allowedOrigins,
        revoked: k.revokedAt !== null,
        createdAt: formatDateTime(k.createdAt, conta.timeZone),
        lastUsed: k.lastUsedAt ? formatDateTime(k.lastUsedAt, conta.timeZone) : null,
        usage: {
          requests,
          errors: linhas.reduce((s, r) => s + r.errorCount, 0),
          avgMs: requests === 0 ? 0 : Math.round(ms / requests),
          routes: [...linhas].sort((a, b) => b.count - a.count).slice(0, 5).map((r) => ({ route: r.route, count: r.count })),
        },
      }
    }),
  )
  return <KeysPanel businessId={conta.id} chaves={dados} />
}
