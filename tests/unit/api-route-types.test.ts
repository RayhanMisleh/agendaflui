import { defineRoute } from '@/server/api/define-route'
import { z } from '@/server/domain/errors'

// Este arquivo existe para o `npm run typecheck`: os `@ts-expect-error` provam que o tipo do handler depende de `auth`.
// Os handlers nunca rodam.

const resposta = z.object({ id: z.string() })

describe('tipo do handler por autenticação', () => {
  test('customer, staff, guest e guest_or_customer recebem ctx e business sem checagem de nulo; none nada', () => {
    const cliente = defineRoute({
      method: 'GET',
      path: '/v1/tipos/cliente',
      auth: 'customer',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, business }) => ({ id: `${ctx.businessId}${business.id}${ctx.actor.kind}` }),
    })
    const equipe = defineRoute({
      method: 'GET',
      path: '/v1/tipos/equipe',
      auth: 'staff',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, business }) => ({ id: ctx.businessId + business.slug }),
    })
    const visitante = defineRoute({
      method: 'GET',
      path: '/v1/tipos/visitante',
      auth: 'guest',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, business }) => ({ id: business.id + ctx.businessId + ctx.actor.kind }),
    })
    const visitanteOuCliente = defineRoute({
      method: 'GET',
      path: '/v1/tipos/visitante-ou-cliente',
      auth: 'guest_or_customer',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, business }) => ({ id: business.id + ctx.businessId + ctx.actor.kind }),
    })
    const publica = defineRoute({
      method: 'GET',
      path: '/v1/tipos/publica',
      auth: 'none',
      summary: 's',
      tag: 't',
      response: resposta,
      handler: async ({ ctx, business }) => {
        // @ts-expect-error rota `none` não tem business (o tipo é null)
        const negado: string = business.id
        // @ts-expect-error rota `none` não tem ctx (o tipo é null)
        const tambem: string = ctx.businessId
        void tambem
        return { id: negado }
      },
    })
    expect([cliente, equipe, visitante, visitanteOuCliente, publica].every((h) => typeof h === 'function')).toBe(true)
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
