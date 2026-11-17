import type { Metadata } from 'next'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { areaLink } from '@/server/area-links'
import { listApiKeys } from '@/server/domain/platform/api-keys'
import { usageSummary } from '@/server/domain/platform/api-usage'
import { listBusinesses } from '@/server/domain/platform/businesses'
import { addMinutes } from '@/server/time'
import { EmptyState, LinkButton, Pagination, SearchBar } from '@/ui/components'
import { DevFrame } from '../DevFrame'
import { quando } from '../_lib/format'
import { um } from '../_lib/params'
import { ChavesPanel, SemChaves } from './ChavesPanel'
import type { ChaveGlobal, UsoPeriodo } from './ChavesPanel'
import { criarChavePlataforma, revogarChave } from './actions'

export const metadata: Metadata = { title: 'Chaves e API | AgendaFlui' }

const POR_PAGINA = 50
const TIPOS = [
  { value: '', label: 'Todas' },
  { value: 'PLATFORM', label: 'De plataforma' },
  { value: 'ACCOUNT', label: 'De conta' },
]
const SITUACOES = [
  { value: '', label: 'Todas' },
  { value: 'ativas', label: 'Ativas' },
  { value: 'revogadas', label: 'Revogadas' },
]

function somar(linhas: Awaited<ReturnType<typeof usageSummary>>): UsoPeriodo {
  const requests = linhas.reduce((s, r) => s + r.count, 0)
  const ms = linhas.reduce((s, r) => s + r.avgMs * r.count, 0)
  return { requests, errors: linhas.reduce((s, r) => s + r.errorCount, 0), avgMs: requests === 0 ? 0 : Math.round(ms / requests) }
}

export default async function ChavesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin()
  const q = await searchParams
  const busca = um(q.search).trim().slice(0, 100)
  const tipo = TIPOS.find((t) => t.value !== '' && t.value === um(q.tipo))?.value ?? ''
  const situacao = SITUACOES.find((s) => s.value !== '' && s.value === um(q.situacao))?.value ?? ''
  const cursor = um(q.cursor) || null

  const todas = await listApiKeys(admin)
  const termo = busca.toLowerCase()
  const filtradas = todas.filter(
    (k) =>
      (tipo === '' || k.kind === tipo) &&
      (situacao === '' || (situacao === 'ativas') === (k.revokedAt === null)) &&
      (termo === '' || k.name.toLowerCase().includes(termo) || k.prefix.includes(termo)),
  )
  // Cursor: o id da última chave da página anterior. Cursor que não existe mais volta ao começo da lista.
  const inicio = cursor ? filtradas.findIndex((k) => k.id === cursor) + 1 : 0
  const pagina = filtradas.slice(inicio, inicio + POR_PAGINA)
  const ultima = pagina[pagina.length - 1]
  const proximo = ultima && inicio + POR_PAGINA < filtradas.length ? ultima.id : null

  const agora = new Date()
  const desde7 = addMinutes(agora, -7 * 24 * 60)
  const desde30 = addMinutes(agora, -30 * 24 * 60)
  const nomes = new Map((await listBusinesses(admin, { limit: 100 })).items.map((c) => [c.id, c.name]))
  const chaves: ChaveGlobal[] = await Promise.all(
    pagina.map(async (k) => {
      const [l7, l30] = await Promise.all([
        usageSummary(admin, { from: desde7, to: agora, apiKeyId: k.id }),
        usageSummary(admin, { from: desde30, to: agora, apiKeyId: k.id }),
      ])
      return {
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        kind: k.kind,
        contaId: k.businessId,
        contaNome: k.businessId ? (nomes.get(k.businessId) ?? null) : null,
        origins: k.allowedOrigins,
        revoked: k.revokedAt !== null,
        createdAt: quando(k.createdAt),
        lastUsed: k.lastUsedAt ? quando(k.lastUsedAt) : null,
        uso7: somar(l7),
        uso30: somar(l30),
        routes: [...l30].sort((a, b) => b.count - a.count).slice(0, 5).map((r) => ({ route: r.route, count: r.count })),
        revogar: revogarChave.bind(null, k.id),
      }
    }),
  )

  const filtrado = busca !== '' || tipo !== '' || situacao !== ''
  const params = { search: busca || undefined, tipo: tipo || undefined, situacao: situacao || undefined }
  return (
    <DevFrame
      admin={admin}
      title="Chaves e API"
      actions={<LinkButton href={areaLink('api', '/v1/openapi.json')}>Documentação OpenAPI</LinkButton>}
    >
      <ChavesPanel
        criar={criarChavePlataforma}
        chaves={chaves}
        filtros={
          <SearchBar
            action="/chaves"
            label="Buscar chaves"
            placeholder="Nome ou prefixo"
            query={busca}
            filters={[
              { name: 'tipo', label: 'Tipo', value: tipo, options: TIPOS },
              { name: 'situacao', label: 'Situação', value: situacao, options: SITUACOES },
            ]}
            clearHref="/chaves"
          />
        }
        vazio={
          filtrado ? (
            <EmptyState title="Nenhuma chave encontrada" description="Nada combina com a busca. Mude o nome, o tipo ou a situação." action={<LinkButton href="/chaves">Limpar busca</LinkButton>} />
          ) : (
            <SemChaves />
          )
        }
      />
      <Pagination basePath="/chaves" params={params} cursor={cursor} nextCursor={proximo} />
    </DevFrame>
  )
}
