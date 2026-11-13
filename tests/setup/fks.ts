import type { Prisma } from '@/server/db/generated/client'

type Fk = {
  origem: string
  destino: string
  colunas: string[]
  colunas_destino: string[]
  on_update: string
}

/**
 * Confere as FKs entre as tabelas informadas (origem e destino ambos na lista): toda relação entre
 * tabelas de conta precisa de FK composta com o par `business_id -> business_id` (exceto a que
 * aponta para `businesses` só por `business_id`), e nenhuma FK composta com `business_id` pode usar
 * ON UPDATE CASCADE. Devolve uma descrição por problema; lista vazia quer dizer tudo certo.
 */
export async function verificarFks(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  tabelas: readonly string[],
): Promise<string[]> {
  const conjunto = new Set(tabelas)
  const fks = await db.$queryRaw<Fk[]>`
    select src.relname::text as origem, dst.relname::text as destino, c.confupdtype::text as on_update,
      array(select a.attname::text from unnest(c.conkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum order by k.ord) as colunas,
      array(select a.attname::text from unnest(c.confkey) with ordinality as k(attnum, ord)
        join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum order by k.ord) as colunas_destino
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_class dst on dst.oid = c.confrelid
    join pg_namespace n on n.oid = src.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
    order by src.relname, c.conname
  `
  const prendeConta = (fk: Fk): boolean =>
    fk.colunas.length > 1 && fk.colunas.some((c, i) => c === 'business_id' && fk.colunas_destino[i] === 'business_id')

  const problemas: string[] = []
  for (const fk of fks) {
    if (!conjunto.has(fk.origem) || !conjunto.has(fk.destino)) continue
    const descricao = `${fk.origem} (${fk.colunas.join(', ')}) -> ${fk.destino}`
    if (prendeConta(fk) && fk.on_update === 'c') {
      problemas.push(`${descricao}: FK composta com business_id não pode usar ON UPDATE CASCADE`)
    }
    const paraBusinesses = fk.destino === 'businesses' && fk.colunas.length === 1 && fk.colunas[0] === 'business_id'
    if (paraBusinesses) continue
    const coberta = fks.some(
      (o) =>
        o.origem === fk.origem && o.destino === fk.destino && prendeConta(o) && fk.colunas.every((c) => o.colunas.includes(c)),
    )
    if (!coberta) problemas.push(`${descricao}: falta FK composta com business_id`)
  }
  return problemas
}
