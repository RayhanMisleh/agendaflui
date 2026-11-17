import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { reportCsv } from '@/server/domain/reports/csv'
import { todayIn } from '@/server/time'
import { periodoDaUrl } from '../periodo'

const SEM_CACHE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

const STATUS_DO_ERRO: Record<string, number> = { forbidden: 403, validation: 422, not_found: 404 }

function recusa(err: DomainError): Response {
  return new Response(err.message, {
    status: STATUS_DO_ERRO[err.code] ?? 400,
    headers: { ...SEM_CACHE, 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Baixa o relatório detalhado em CSV. Só GET, só com sessão do painel (sem ela, `requireTenant` redireciona para a
 * entrada). Vale o mesmo período e os mesmos filtros da tela. Quem só vê os próprios números não escolhe profissional: o
 * parâmetro é ignorado e o arquivo traz só as linhas dele. Permissão e período são conferidos no primeiro pedaço do
 * gerador, ANTES de abrir a resposta, para o erro sair como 403 ou 422 e não como um arquivo cortado.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await requireTenant()
  const q = new URL(request.url).searchParams
  const texto = (nome: string): string | undefined => {
    const v = q.get(nome)
    return v === null || v === '' ? undefined : v
  }
  const periodo = periodoDaUrl({ atalho: texto('atalho'), de: texto('de'), ate: texto('ate') }, todayIn(ctx.timeZone, ctx.clock()))
  const professionalId = can(ctx.actor, 'view_all_reports') ? texto('profissional') : undefined
  const serviceId = texto('servico')
  const csv = reportCsv(ctx, {
    from: periodo.from,
    to: periodo.to,
    ...(professionalId ? { professionalId } : {}),
    ...(serviceId ? { serviceId } : {}),
  })

  let primeiro: IteratorResult<string, void>
  try {
    primeiro = await csv.next()
  } catch (err) {
    if (err instanceof DomainError) return recusa(err)
    throw err
  }

  const codificar = new TextEncoder()
  const corpo = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!primeiro.done) controller.enqueue(codificar.encode(primeiro.value))
      if (primeiro.done) controller.close()
    },
    async pull(controller) {
      if (primeiro.done) return
      try {
        const proximo = await csv.next()
        if (proximo.done) controller.close()
        else controller.enqueue(codificar.encode(proximo.value))
      } catch (err) {
        controller.error(err)
      }
    },
    async cancel() {
      await csv.return()
    },
  })
  return new Response(corpo, {
    status: 200,
    headers: {
      ...SEM_CACHE,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="relatorio-${periodo.from}-a-${periodo.to}.csv"`,
    },
  })
}
