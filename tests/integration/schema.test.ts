import { beforeEach, describe, expect, test } from 'vitest'
import { Prisma } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { PLATFORM_MODELS, SELF_MODELS, TENANT_MODELS, TENANT_OPTIONAL_MODELS } from '@/server/db/models'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeUser } from '../setup/factories'
import { verificarFks } from '../setup/fks'

// O nome da tabela de cada modelo vem dos metadados do Prisma (`dbName`); modelo sem mapeamento
// derruba o teste dizendo qual é, em vez de ser pulado.
function tabelaDoModelo(nome: string): string {
  const modelos = (prisma as unknown as { _runtimeDataModel?: { models?: Record<string, { dbName?: string | null }> } })
    ._runtimeDataModel?.models
  const tabela = modelos?.[nome]?.dbName
  if (!tabela) throw new Error(`Modelo ${nome} sem nome de tabela (@@map) nos metadados do Prisma.`)
  return tabela
}

beforeEach(async () => {
  await resetDb()
})

describe('classificação dos modelos', () => {
  test('todo modelo está em exatamente uma das quatro listas', () => {
    const todos = Object.values(Prisma.ModelName).sort()
    expect(
      [...TENANT_MODELS, ...TENANT_OPTIONAL_MODELS, ...SELF_MODELS, ...PLATFORM_MODELS].sort(),
    ).toEqual(todos)
  })

  test('todo modelo tenant-opcional tem business_id anulável', async () => {
    for (const nome of TENANT_OPTIONAL_MODELS) {
      const campos = (Prisma as unknown as Record<string, Record<string, string>>)[
        `${nome}ScalarFieldEnum`
      ]
      expect(campos?.['businessId'], nome).toBeDefined()
      const linhas = await prisma.$queryRaw<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = ${tabelaDoModelo(nome)} and column_name = 'business_id'
      `
      expect(linhas[0]?.is_nullable, nome).toBe('YES')
    }
  })

  test('todo modelo tenant tem business_id obrigatório', async () => {
    for (const nome of TENANT_MODELS) {
      const campos = (Prisma as unknown as Record<string, Record<string, string>>)[
        `${nome}ScalarFieldEnum`
      ]
      expect(campos?.['businessId'], nome).toBeDefined()
      const tabela = tabelaDoModelo(nome)
      const linhas = await prisma.$queryRaw<{ is_nullable: string }[]>`
        select is_nullable from information_schema.columns
        where table_schema = 'public' and table_name = ${tabela} and column_name = 'business_id'
      `
      expect(linhas[0]?.is_nullable, nome).toBe('NO')
    }
  })
})

describe('relações entre tabelas de conta', () => {
  test('toda FK entre tabelas de conta fica dentro da mesma conta (FK composta com business_id)', async () => {
    const tabelasDeConta = [...TENANT_MODELS, ...TENANT_OPTIONAL_MODELS, ...SELF_MODELS].map(tabelaDoModelo)
    expect(tabelasDeConta).toHaveLength(new Set(tabelasDeConta).size)
    expect(await verificarFks(prisma, tabelasDeConta)).toEqual([])
  })

  test('modelo sem nome de tabela nos metadados derruba o teste nomeando o modelo', () => {
    expect(() => tabelaDoModelo('ModeloQueNaoExiste')).toThrow(/ModeloQueNaoExiste/)
  })
})

describe('a verificação de FK acusa o que está errado', () => {
  class Desfazer extends Error {}
  const ddl = `
    create table t_a (id uuid primary key, business_id uuid not null, unique (business_id, id), unique (id, business_id));
    create table t_b (id uuid primary key, business_id uuid not null, a_id uuid);
    create table t_c (id uuid primary key, business_id uuid not null, a_id uuid);
    create table t_d (id uuid primary key, business_id uuid not null, a_id uuid);
    create table t_e (id uuid primary key, business_id uuid not null, a_id uuid);
    alter table t_b add foreign key (a_id) references t_a (id);
    alter table t_c add foreign key (business_id, a_id) references t_a (id, business_id);
    alter table t_d add foreign key (business_id, a_id) references t_a (business_id, id) on update cascade;
    alter table t_e add foreign key (business_id, a_id) references t_a (business_id, id) on update no action;
  `
  async function emTransacaoDescartada<T>(corpo: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let resultado: T | undefined
    await prisma
      .$transaction(async (tx) => {
        for (const comando of ddl.split(';').map((c) => c.trim()).filter(Boolean)) await tx.$executeRawUnsafe(comando)
        resultado = await corpo(tx)
        throw new Desfazer()
      })
      .catch((e: unknown) => {
        if (!(e instanceof Desfazer)) throw e
      })
    return resultado as T
  }

  test('FK simples entre duas tabelas com business_id é acusada', async () => {
    const r = await emTransacaoDescartada((tx) => verificarFks(tx, ['t_a', 't_b']))
    expect(r).toEqual(['t_b (a_id) -> t_a: falta FK composta com business_id'])
  })

  test('FK composta com o mapeamento trocado é acusada', async () => {
    const r = await emTransacaoDescartada((tx) => verificarFks(tx, ['t_a', 't_c']))
    expect(r).toEqual(['t_c (business_id, a_id) -> t_a: falta FK composta com business_id'])
  })

  test('FK composta com ON UPDATE CASCADE é acusada; com NO ACTION passa', async () => {
    expect(await emTransacaoDescartada((tx) => verificarFks(tx, ['t_a', 't_d']))).toEqual([
      't_d (business_id, a_id) -> t_a: FK composta com business_id não pode usar ON UPDATE CASCADE',
    ])
    expect(await emTransacaoDescartada((tx) => verificarFks(tx, ['t_a', 't_e']))).toEqual([])
  })

  test('tabela fora da lista não é conferida', async () => {
    expect(await emTransacaoDescartada((tx) => verificarFks(tx, ['t_a']))).toEqual([])
  })
})

describe('restrições no banco', () => {
  test('upload que é logo de uma marca não muda de conta e a marca fica onde está', async () => {
    const a = await prisma.business.create({ data: { slug: 'conta-a', name: 'A' } })
    const b = await prisma.business.create({ data: { slug: 'conta-b', name: 'B' } })
    const up = await prisma.upload.create({
      data: { businessId: a.id, path: 'a/l.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, createdByType: 'SYSTEM' },
    })
    await prisma.businessBranding.create({ data: { businessId: a.id, displayName: 'A', logoUploadId: up.id } })
    await expect(prisma.upload.update({ where: { id: up.id }, data: { businessId: b.id } })).rejects.toThrow()
    expect((await prisma.upload.findUniqueOrThrow({ where: { id: up.id } })).businessId).toBe(a.id)
    const marca = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: a.id } })
    expect(marca.logoUploadId).toBe(up.id)
  })

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

  test('apagar um usuário com sessão remove a sessão', async () => {
    const user = await prisma.user.create({ data: { name: 'A', email: 'a@x.com' } })
    const s = await prisma.session.create({
      data: { tokenHash: 'c1', userId: user.id, expiresAt: new Date(Date.now() + 1000) },
    })
    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull()
  })

  test('apagar um admin com sessão de impersonação remove a sessão', async () => {
    const admin = await prisma.platformAdmin.create({
      data: { name: 'Adm', email: 'adm@x.com', passwordHash: 'h' },
    })
    const s = await prisma.session.create({
      data: { tokenHash: 'c2', impersonatorAdminId: admin.id, expiresAt: new Date(Date.now() + 1000) },
    })
    await prisma.platformAdmin.delete({ where: { id: admin.id } })
    expect(await prisma.session.findUnique({ where: { id: s.id } })).toBeNull()
  })

  test('apagar a conta ativa de uma sessão mantém a sessão com conta nula', async () => {
    const b = await prisma.business.create({ data: { slug: 'loja-ativa', name: 'Loja' } })
    const user = await prisma.user.create({ data: { name: 'A', email: 'a@x.com' } })
    const s = await prisma.session.create({
      data: {
        tokenHash: 'c3',
        userId: user.id,
        activeBusinessId: b.id,
        expiresAt: new Date(Date.now() + 1000),
      },
    })
    await prisma.business.delete({ where: { id: b.id } })
    const depois = await prisma.session.findUniqueOrThrow({ where: { id: s.id } })
    expect(depois.activeBusinessId).toBeNull()
  })

  test('apagar uma conta remove os uploads dela', async () => {
    const b = await prisma.business.create({ data: { slug: 'loja-upl', name: 'Loja' } })
    const u = await prisma.upload.create({
      data: {
        businessId: b.id,
        path: 'a/b.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        width: 1,
        height: 1,
        createdByType: 'SYSTEM',
      },
    })
    await prisma.business.delete({ where: { id: b.id } })
    expect(await prisma.upload.findUnique({ where: { id: u.id } })).toBeNull()
  })
})

describe('sem API do app, push nem métricas de uso', () => {
  test('as tabelas api_usage_hourly, refresh_tokens e devices não existem', async () => {
    const r = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('api_usage_hourly', 'refresh_tokens', 'devices')`
    expect(r).toEqual([])
  })

  test('o canal de aviso só tem e-mail e o cliente não tem colunas de push', async () => {
    const canais = await prisma.$queryRaw<{ v: string }[]>`SELECT unnest(enum_range(NULL::notification_channel))::text AS v`
    expect(canais.map((c) => c.v)).toEqual(['EMAIL'])
    const colunas = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'customers' AND column_name LIKE 'notify_push%'`
    expect(colunas).toEqual([])
  })

  test('scheduler_runs_kind_check recusa usage_flush e aceita as tarefas atuais', async () => {
    const agora = new Date()
    await expect(prisma.schedulerRun.create({ data: { kind: 'usage_flush', startedAt: agora, ok: true } })).rejects.toThrow()
    for (const kind of ['notifications', 'cleanup', 'store', 'retention']) {
      await prisma.schedulerRun.create({ data: { kind, startedAt: agora, ok: true } })
    }
  })
})

describe('pessoa única', () => {
  const indice = async (nome: string) =>
    prisma.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${nome}`

  test('email_codes existe com o índice parcial email_codes_live_key', async () => {
    const t = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('email_codes')::text AS t`
    expect(t[0]?.t).toBe('email_codes')
    const def = (await indice('email_codes_live_key'))[0]?.indexdef ?? ''
    expect(def).toContain('UNIQUE')
    expect(def).toContain('consumed_at IS NULL')
  })

  test('customers_business_id_user_id_key e users_google_sub_key são únicos', async () => {
    expect((await indice('customers_business_id_user_id_key'))[0]?.indexdef).toContain('UNIQUE')
    expect((await indice('users_google_sub_key'))[0]?.indexdef).toContain('UNIQUE')
    const b = await makeBusiness()
    const u = await makeUser()
    await makeCustomer(b.id, { userId: u.id })
    await expect(makeCustomer(b.id, { userId: u.id, email: 'outro@exemplo.test' })).rejects.toThrow()
    await makeUser({ google: { sub: 'sub-1', email: 'g1@exemplo.test' } })
    await expect(makeUser({ google: { sub: 'sub-1', email: 'g2@exemplo.test' } })).rejects.toThrow()
  })

  test('users_active_verified recusa pessoa com senha e sem verificação', async () => {
    await expect(makeUser({ password: 'senha-bem-longa', verified: false })).rejects.toThrow(/users_active_verified/)
    await expect(makeUser({ google: { sub: 'sub-x', email: 'x@exemplo.test' }, verified: false })).rejects.toThrow(/users_active_verified/)
    await makeUser({ password: null, verified: false })
  })

  test('users_google_together recusa google_sub sem google_email', async () => {
    await expect(makeUser({ googleSub: 'sub-y' })).rejects.toThrow(/users_google_together/)
  })

  test('cliente com conta exige e-mail e linked_at juntos com user_id', async () => {
    const b = await makeBusiness()
    const u = await makeUser()
    await expect(prisma.customer.create({ data: { businessId: b.id, name: 'X', origin: 'APP', userId: u.id, linkedAt: new Date() } })).rejects.toThrow(/customers_account_has_email/)
    await expect(prisma.customer.create({ data: { businessId: b.id, name: 'X', origin: 'APP', userId: u.id, email: 'x@exemplo.test' } })).rejects.toThrow(/customers_linked_together/)
  })
})
