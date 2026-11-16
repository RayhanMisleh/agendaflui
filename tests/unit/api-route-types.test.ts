import { defineRoute } from '@/server/api/define-route'
import { z } from '@/server/domain/errors'

// Este arquivo existe para o `npm run typecheck`: os `@ts-expect-error` provam que o tipo do handler depende de `auth`.
// Os handlers nunca rodam.

const resposta = z.object({ id: z.string() })

describe('tipo do handler por autenticação', () => {
  test('customer, staff, key e key_or_customer recebem ctx e key sem checagem de nulo; none nada', () => {
    const cliente = defineRoute({
      method: 'GET',
      path: '/v1/tipos/cliente',
      auth: 'customer',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, key }) => ({ id: `${ctx.businessId}${key.businessId}${ctx.actor.kind}` }),
    })
    const equipe = defineRoute({
      method: 'GET',
      path: '/v1/tipos/equipe',
      auth: 'staff',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, key }) => ({ id: ctx.businessId + key.businessSlug }),
    })
    const porChave = defineRoute({
      method: 'GET',
      path: '/v1/tipos/chave',
      auth: 'key',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, key }) => ({ id: key.businessId + ctx.businessId + ctx.actor.kind }),
    })
    const chaveOuCliente = defineRoute({
      method: 'GET',
      path: '/v1/tipos/chave-ou-cliente',
      auth: 'key_or_customer',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, key }) => ({ id: key.businessId + ctx.businessId + ctx.actor.kind }),
    })
    const publica = defineRoute({
      method: 'GET',
      path: '/v1/tipos/publica',
      auth: 'none',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ key }) => {
        // @ts-expect-error rota `none` não tem key (o tipo é null)
        const negado: string = key.businessId
        return { id: negado }
      },
    })
    expect([cliente, equipe, porChave, chaveOuCliente, publica].every((h) => typeof h === 'function')).toBe(true)
  })

  test('o handler pode devolver Date e bigint onde o esquema de fio diz texto e número', () => {
    const h = defineRoute({
      method: 'GET',
      path: '/v1/tipos/datas',
      auth: 'none',
      summary: 's',
      tag: 't',
      response: z.object({ quando: z.iso.datetime(), n: z.number() }),
      handler: async () => ({ quando: new Date(0), n: 3n }),
    })
    expect(typeof h).toBe('function')
  })
})
