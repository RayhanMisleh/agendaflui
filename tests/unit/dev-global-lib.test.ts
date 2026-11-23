import { toIsoInstant } from '@/server/time'
import { PLATFORM_TIME_ZONE, quando, tamanho, taxaDeSucesso } from '@/app/dev/(app)/_lib/format'
import { renomear } from '@/app/_lib/campos'
import { DomainError } from '@/server/domain/errors'
import { porCodigo, um } from '@/app/_lib/params'
import { traduzirFaltou, traduzirSuporte } from '@/app/dev/(app)/contas/[id]/codigos-url'
import { formatInt } from '@/ui/format'
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
    const f = lerFiltros({ de: '2026-11-01', ate: '2026-11-10', acao: 'admin.deactivated', ator: 'PLATFORM_ADMIN', conta: 'x', cursor: 'c' })
    expect(f.erro).toBeNull()
    expect(toIsoInstant(f.query.from!)).toBe('2026-11-01T03:00:00.000Z')
    expect(toIsoInstant(f.query.to!)).toBe('2026-11-11T03:00:00.000Z')
    expect(f.query).toMatchObject({ action: 'admin.deactivated', actorType: 'PLATFORM_ADMIN', cursor: 'c' })
    expect(f.query.businessId).toBeUndefined()
    expect(f.values.conta).toBe('x')
    expect(f.values).toMatchObject({ de: '2026-11-01', ate: '2026-11-10' })
  })

  test('data inválida e tipo de ator desconhecido não viram 500: aviso e filtro ignorado', () => {
    const f = lerFiltros({ de: '31/02/2026', ator: 'ROOT' })
    expect(f.erro).toMatch(/data/i)
    expect(f.query.from).toBeUndefined()
    expect(f.query.actorType).toBeUndefined()
  })

  test('quem agiu fora da lista vira mensagem de filtro inválido, e o filtro é ignorado', () => {
    const f = lerFiltros({ ator: 'ROOT' })
    expect(f.erro).toMatch(/quem agiu/i)
    expect(f.query.actorType).toBeUndefined()
    expect(f.values.ator).toBe('')
    expect(lerFiltros({ ator: 'SYSTEM' }).erro).toBeNull()
    expect(lerFiltros({ ator: '' }).erro).toBeNull()
  })

  test('valor repetido na URL vale o primeiro', () => {
    expect(lerFiltros({ acao: ['a', 'b'] }).query.action).toBe('a')
  })
})

test('os cinco destinos do painel estão todos habilitados', () => {
  expect(DEV_NAV.filter((n) => n.disabled)).toEqual([])
})

describe('códigos da URL nunca leem o protótipo do objeto', () => {
  const mapa = { ok: 'texto' }
  test('porCodigo só devolve chave própria', () => {
    expect(porCodigo(mapa, 'ok')).toBe('texto')
    for (const c of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '', 'x']) expect(porCodigo(mapa, c), c).toBeUndefined()
  })

  test('?suporte= traduz só os códigos conhecidos', () => {
    expect(traduzirSuporte('arquivada')).toMatch(/arquivada/)
    expect(traduzirSuporte('falhou')).toMatch(/suporte/)
    for (const c of ['__proto__', 'constructor', '', 'qualquer']) expect(traduzirSuporte(c), c).toBeUndefined()
  })

  test('?faltou= traduz só os códigos conhecidos, ignora o resto e não repete', () => {
    expect(traduzirFaltou('marca,termos')).toEqual(['a marca (cores e barra lateral)', 'os termos'])
    expect(traduzirFaltou('constructor,__proto__,toString,marca,marca')).toEqual(['a marca (cores e barra lateral)'])
    expect(traduzirFaltou('')).toEqual([])
    // O código `chave` saiu junto com a chave de app.
    expect(traduzirFaltou('chave')).toEqual([])
  })

  test('um() pega o primeiro valor ou texto vazio', () => {
    expect(um(['a', 'b'])).toBe('a')
    expect(um(undefined)).toBe('')
  })
})

test('formatInt: inteiro em pt-BR, com ponto de milhar, arredondado', () => {
  expect(formatInt(0)).toBe('0')
  expect(formatInt(1234567)).toBe('1.234.567')
  expect(formatInt(12.6)).toBe('13')
})

describe('taxa de sucesso da visão geral', () => {
  test('arredonda para baixo: nunca 100% com erro', () => {
    expect(taxaDeSucesso(1000, 0)).toBe(1)
    expect(taxaDeSucesso(100_000, 1)).toBe(0.999)
    expect(taxaDeSucesso(1_000_000, 1)).toBe(0.999)
    expect(taxaDeSucesso(3, 1)).toBe(0.666)
    expect(taxaDeSucesso(1000, 5)).toBe(0.995)
    expect(taxaDeSucesso(10, 10)).toBe(0)
    expect(taxaDeSucesso(0, 0)).toBe(1)
  })
})

test('renomear troca o nome inteiro do campo (owner.email) ou só o começo (origens.0), e deixa o resto', () => {
  const err = new DomainError('validation', 'x', { fields: { 'owner.email': 'a', 'allowedOrigins.0': 'b', outro: 'c', constructor: 'd' } })
  const r = renomear(err, { 'owner.email': 'ownerEmail', allowedOrigins: 'origins' })
  expect(r).toBeInstanceOf(DomainError)
  expect((r as DomainError).fields).toEqual({ ownerEmail: 'a', origins: 'b', outro: 'c', constructor: 'd' })
  expect(renomear(new Error('y'), {})).toBeInstanceOf(Error)
})

test('formatDuration: minutos, horas cheias e horas com minutos', async () => {
  const { formatDuration } = await import('@/ui/format')
  expect(formatDuration(45)).toBe('45 min')
  expect(formatDuration(60)).toBe('1 h')
  expect(formatDuration(90)).toBe('1 h 30')
  expect(formatDuration(125)).toBe('2 h 05')
  expect(formatDuration(-5)).toBe('0 min')
})

test('weekdayName e shortDate: nomes em português e data curta', async () => {
  const { weekdayName, shortDate } = await import('@/ui/format')
  expect(weekdayName('TUESDAY')).toBe('Terça-feira')
  expect(weekdayName('SATURDAY')).toBe('Sábado')
  expect(shortDate('2026-11-18')).toBe('18/11')
})
