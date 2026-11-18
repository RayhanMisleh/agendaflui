import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { integrations, setIntegrationsForTests } from '@/server/integrations'
import { IntegrationError } from '@/server/integrations/errors'
import { fakePostalCodes } from '@/server/integrations/fakes'
import { createViaCepGateway } from '@/server/integrations/viacep'

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.useRealTimers()
  setIntegrationsForTests(null)
})

describe('ViaCEP real (fetch falso)', () => {
  test('consulta o endereço certo e converte os campos', async () => {
    const chamadas: string[] = []
    const g = createViaCepGateway({
      fetch: async (url) => {
        chamadas.push(String(url))
        return json({ cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' })
      },
    })
    expect(await g.lookup('01310100')).toEqual({ street: 'Avenida Paulista', district: 'Bela Vista', city: 'São Paulo', state: 'SP' })
    expect(chamadas).toEqual(['https://viacep.com.br/ws/01310100/json/'])
  })

  test('CEP de cidade pequena: rua e bairro vêm vazios e a resposta vale', async () => {
    const g = createViaCepGateway({ fetch: async () => json({ cep: '69900-000', logradouro: '', bairro: '', localidade: 'Rio Branco', uf: 'AC' }) })
    expect(await g.lookup('69900000')).toEqual({ street: '', district: '', city: 'Rio Branco', state: 'AC' })
  })

  test('{"erro": true} é CEP que não existe: devolve null', async () => {
    expect(await createViaCepGateway({ fetch: async () => json({ erro: true }) }).lookup('99999999')).toBeNull()
    expect(await createViaCepGateway({ fetch: async () => json({ erro: 'true' }) }).lookup('99999999')).toBeNull()
  })

  test('500 vira IntegrationError unavailable; 400 vira rejected', async () => {
    const e500 = await createViaCepGateway({ fetch: async () => new Response('x', { status: 500 }) }).lookup('01310100').catch((e: unknown) => e)
    expect(e500).toBeInstanceOf(IntegrationError)
    expect((e500 as IntegrationError).code).toBe('unavailable')
    const e400 = await createViaCepGateway({ fetch: async () => new Response('x', { status: 400 }) }).lookup('01310100').catch((e: unknown) => e)
    expect((e400 as IntegrationError).code).toBe('rejected')
  })

  test('falha de rede vira unavailable', async () => {
    const g = createViaCepGateway({ fetch: async () => { throw new TypeError('fetch failed') } })
    expect(((await g.lookup('01310100').catch((e: unknown) => e)) as IntegrationError).code).toBe('unavailable')
  })

  test('resposta fora do formato vira invalid_response (texto, lista, campos faltando, UF inválida)', async () => {
    for (const corpo of ['oi', [], {}, { localidade: 'São Paulo' }, { localidade: 'São Paulo', uf: 'SPP', logradouro: '', bairro: '' }, { localidade: 1, uf: 'SP' }]) {
      const g = createViaCepGateway({ fetch: async () => json(corpo) })
      const e = (await g.lookup('01310100').catch((x: unknown) => x)) as IntegrationError
      expect(e, JSON.stringify(corpo)).toBeInstanceOf(IntegrationError)
      expect(e.code, JSON.stringify(corpo)).toBe('invalid_response')
    }
    const g = createViaCepGateway({ fetch: async () => new Response('<html>', { status: 200 }) })
    expect(((await g.lookup('01310100').catch((x: unknown) => x)) as IntegrationError).code).toBe('invalid_response')
  })

  test('demora de mais de 5 s vira timeout (relógio falso) e aborta a chamada', async () => {
    vi.useFakeTimers()
    let abortado = false
    const g = createViaCepGateway({
      fetch: (_url, init) =>
        new Promise<Response>((_ok, falha) => {
          init?.signal?.addEventListener('abort', () => {
            abortado = true
            falha(new DOMException('aborted', 'AbortError'))
          })
        }),
    })
    const p = g.lookup('01310100').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(abortado).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    const e = (await p) as IntegrationError
    expect(e).toBeInstanceOf(IntegrationError)
    expect(e.code).toBe('timeout')
    expect(abortado).toBe(true)
  })

  test('um fetch que ignora o aborto também expira', async () => {
    vi.useFakeTimers()
    const g = createViaCepGateway({ fetch: () => new Promise<Response>(() => undefined) })
    const p = g.lookup('01310100').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_001)
    expect(((await p) as IntegrationError).code).toBe('timeout')
  })

  test('a mensagem de erro não traz o CEP nem a resposta', async () => {
    const g = createViaCepGateway({ fetch: async () => json({ localidade: 'segredo-na-resposta' }) })
    const e = (await g.lookup('01310100').catch((x: unknown) => x)) as IntegrationError
    expect(e.message).not.toContain('01310100')
    expect(e.message).not.toContain('segredo-na-resposta')
  })
})

describe('ViaCEP falsa', () => {
  test('devolve um endereço fixo para qualquer CEP de 8 dígitos e null para 00000000', async () => {
    expect(await fakePostalCodes().lookup('01310100')).toEqual({ street: 'Rua das Flores', district: 'Centro', city: 'São Paulo', state: 'SP' })
    expect(await fakePostalCodes().lookup('69900000')).toEqual(await fakePostalCodes().lookup('01310100'))
    expect(await fakePostalCodes().lookup('00000000')).toBeNull()
  })
})

describe('integrations()', () => {
  beforeEach(() => setIntegrationsForTests(null))

  test('em teste devolve a falsa, e setIntegrationsForTests troca só o que foi pedido', async () => {
    expect(await integrations().postalCodes.lookup('01310100')).not.toBeNull()
    const trocada = { lookup: async () => null }
    setIntegrationsForTests({ postalCodes: trocada })
    expect(integrations().postalCodes).toBe(trocada)
    setIntegrationsForTests(null)
    expect(integrations().postalCodes).not.toBe(trocada)
  })
})
