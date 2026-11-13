import { beforeEach, describe, expect, test } from 'vitest'
import { Prisma } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { GLOBAL_MODELS, TENANT_MODELS } from '@/server/db/models'
import { resetDb } from '../setup/db'

// O cliente do Prisma 7 não expõe o DMMF em tempo de execução (só nomes de modelo e de campo),
// então a obrigatoriedade de business_id é lida do próprio banco.
const TABELA_DO_MODELO: Record<string, string> = {
  Membership: 'memberships',
  BusinessBranding: 'business_branding',
  BusinessModules: 'business_modules',
  BusinessSettings: 'business_settings',
}

beforeEach(async () => {
  await resetDb()
})

describe('classificação dos modelos', () => {
  test('todo modelo está classificado como tenant ou global, sem repetição', () => {
    const todos = Object.values(Prisma.ModelName).sort()
    expect([...TENANT_MODELS, ...GLOBAL_MODELS].sort()).toEqual(todos)
  })

  test('todo modelo tenant tem business_id obrigatório', async () => {
    for (const nome of TENANT_MODELS) {
      const campos = (Prisma as unknown as Record<string, Record<string, string>>)[
        `${nome}ScalarFieldEnum`
      ]
      expect(campos?.['businessId'], nome).toBeDefined()
      const tabela = TABELA_DO_MODELO[nome]
      expect(tabela, nome).toBeDefined()
      const linhas = await prisma.$queryRaw<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = ${tabela} and column_name = 'business_id'
      `
      expect(linhas[0]?.is_nullable, nome).toBe('NO')
    }
  })
})

describe('restrições no banco', () => {
  test('slug inválido é recusado pelo banco', async () => {
    await expect(prisma.business.create({ data: { slug: 'Loja Errada', name: 'x' } })).rejects.toThrow()
  })

  test('slug respeita o limite de tamanho: 2 recusado, 3 aceito, 40 aceito, 41 recusado', async () => {
    await expect(prisma.business.create({ data: { slug: 'ab', name: 'x' } })).rejects.toThrow()
    await expect(prisma.business.create({ data: { slug: 'abc', name: 'x' } })).resolves.toBeDefined()
    await expect(
      prisma.business.create({ data: { slug: 'a'.repeat(40), name: 'x' } }),
    ).resolves.toBeDefined()
    await expect(
      prisma.business.create({ data: { slug: 'a'.repeat(41), name: 'x' } }),
    ).rejects.toThrow()
  })

  test('slug com hífen no começo, no fim ou duplo é recusado', async () => {
    for (const slug of ['-abc', 'abc-', 'a--bc']) {
      await expect(prisma.business.create({ data: { slug, name: 'x' } }), slug).rejects.toThrow()
    }
  })

  test('vouchers sem loja é recusado pelo banco', async () => {
    const b = await prisma.business.create({ data: { slug: 'loja-um', name: 'Loja Um' } })
    await expect(
      prisma.businessModules.create({ data: { businessId: b.id, vouchers: true, store: false } }),
    ).rejects.toThrow()
    await expect(
      prisma.businessModules.create({ data: { businessId: b.id, vouchers: true, store: true } }),
    ).resolves.toBeDefined()
  })

  test('e-mail com maiúsculas é recusado pelo banco', async () => {
    await expect(prisma.user.create({ data: { name: 'A', email: 'A@x.com' } })).rejects.toThrow()
    await expect(
      prisma.platformAdmin.create({ data: { name: 'A', email: ' a@x.com', passwordHash: 'h' } }),
    ).rejects.toThrow()
    await expect(prisma.user.create({ data: { name: 'A', email: 'a@x.com' } })).resolves.toBeDefined()
  })

  test('sessão precisa de exatamente um dono', async () => {
    await expect(
      prisma.session.create({ data: { tokenHash: 'h', expiresAt: new Date(Date.now() + 1000) } }),
    ).rejects.toThrow()
    const user = await prisma.user.create({ data: { name: 'A', email: 'a@x.com' } })
    const admin = await prisma.platformAdmin.create({
      data: { name: 'Adm', email: 'adm@x.com', passwordHash: 'h' },
    })
    await expect(
      prisma.session.create({
        data: {
          tokenHash: 'h2',
          userId: user.id,
          impersonatorAdminId: admin.id,
          expiresAt: new Date(Date.now() + 1000),
        },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.session.create({
        data: { tokenHash: 'h3', userId: user.id, expiresAt: new Date(Date.now() + 1000) },
      }),
    ).resolves.toBeDefined()
  })

  test('cor fora do formato #RRGGBB maiúsculo é recusada', async () => {
    const b = await prisma.business.create({ data: { slug: 'loja-cor', name: 'Loja' } })
    for (const primaryColor of ['#0e4f5c', '0E4F5C', '#0E4F5', '#0E4F5CC', '#GGGGGG']) {
      await expect(
        prisma.businessBranding.create({
          data: { businessId: b.id, displayName: 'Loja', primaryColor },
        }),
        primaryColor,
      ).rejects.toThrow()
    }
    await expect(
      prisma.businessBranding.create({
        data: { businessId: b.id, displayName: 'Loja', accentColor: 'azul' },
      }),
    ).rejects.toThrow()
    await expect(
      prisma.businessBranding.create({ data: { businessId: b.id, displayName: 'Loja' } }),
    ).resolves.toBeDefined()
  })

  test('histórico de auditoria sobrevive à remoção da conta', async () => {
    const b = await prisma.business.create({ data: { slug: 'loja-audit', name: 'Loja' } })
    const log = await prisma.auditLog.create({
      data: { businessId: b.id, actorType: 'SYSTEM', actorName: 'sistema', action: 'teste' },
    })
    await prisma.business.delete({ where: { id: b.id } })
    const depois = await prisma.auditLog.findUniqueOrThrow({ where: { id: log.id } })
    expect(depois.businessId).toBeNull()
  })
})
