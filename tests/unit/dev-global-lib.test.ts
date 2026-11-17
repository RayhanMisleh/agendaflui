import { toIsoInstant } from '@/server/time'
import { PLATFORM_TIME_ZONE, quando, tamanho } from '@/app/dev/(app)/_lib/format'
import { lerFiltros } from '@/app/dev/(app)/auditoria/filtros'
import { DEV_NAV } from '@/ui/shells/dev-nav'
import { fromIsoInstant } from '@/server/time'

test('as telas da plataforma usam um fuso só, e a hora sai nele', () => {
  expect(PLATFORM_TIME_ZONE).toBe('America/Sao_Paulo')
  expect(quando(fromIsoInstant('2026-11-16T15:30:00.000Z'))).toBe('16/11/2026 12:30')
})

test('tamanho em unidade legível, com vírgula', () => {
  expect(tamanho(0)).toBe('0 B')
  expect(tamanho(900)).toBe('900 B')
  expect(tamanho(1536)).toBe('1,5 KB')
  expect(tamanho(5 * 1024 * 1024)).toBe('5 MB')
  expect(tamanho(3.25 * 1024 ** 3)).toBe('3,3 GB')
})

describe('filtros da auditoria na URL', () => {
  test('sem nada na URL, nada é filtrado (vale o período padrão do domínio)', () => {
    const f = lerFiltros({})
    expect(f.query).toEqual({})
    expect(f.erro).toBeNull()
  })

  test('as datas valem como dias inteiros no fuso da plataforma, fim inclusivo', () => {
    const f = lerFiltros({ de: '2026-11-01', ate: '2026-11-10', acao: 'api_key.revoked', ator: 'PLATFORM_ADMIN', conta: 'x', cursor: 'c' })
    expect(f.erro).toBeNull()
    expect(toIsoInstant(f.query.from!)).toBe('2026-11-01T03:00:00.000Z')
    expect(toIsoInstant(f.query.to!)).toBe('2026-11-11T03:00:00.000Z')
    expect(f.query).toMatchObject({ action: 'api_key.revoked', actorType: 'PLATFORM_ADMIN', businessId: 'x', cursor: 'c' })
    expect(f.values).toMatchObject({ de: '2026-11-01', ate: '2026-11-10' })
  })

  test('data inválida e tipo de ator desconhecido não viram 500: aviso e filtro ignorado', () => {
    const f = lerFiltros({ de: '31/02/2026', ator: 'ROOT' })
    expect(f.erro).toMatch(/data/i)
    expect(f.query.from).toBeUndefined()
    expect(f.query.actorType).toBeUndefined()
  })

  test('valor repetido na URL vale o primeiro', () => {
    expect(lerFiltros({ acao: ['a', 'b'] }).query.action).toBe('a')
  })
})

test('os seis destinos do painel estão todos habilitados', () => {
  expect(DEV_NAV.filter((n) => n.disabled)).toEqual([])
})
