import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DOMAIN_REASONS, DomainError } from '@/server/domain/errors'

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (caminho.includes(join('src', 'server', 'db', 'generated'))) return []
    return statSync(caminho).isDirectory() ? arquivos(caminho) : caminho.endsWith('.ts') ? [caminho] : []
  })
}

function usados(): Set<string> {
  const encontrados = new Set<string>()
  for (const raiz of ['src/server/domain', 'src/server/db']) {
    for (const arquivo of arquivos(raiz)) {
      for (const m of readFileSync(arquivo, 'utf8').matchAll(/reason: '([a-z_]+)'/g)) {
        if (m[1]) encontrados.add(m[1])
      }
    }
  }
  return encontrados
}

// A garantia de "nenhum reason fora da lista" é do tipo `DomainReason` no typecheck (o construtor de
// `DomainError` só aceita valores da lista). Os testes abaixo conferem o texto dos arquivos nos dois
// sentidos, em especial o inverso: nada na lista sem uso.
describe('DOMAIN_REASONS', () => {
  test('todo reason escrito no domínio e no banco consta na lista', () => {
    const lista: readonly string[] = DOMAIN_REASONS
    expect(usados().size).toBeGreaterThan(10)
    for (const reason of usados()) expect(lista, `falta '${reason}'`).toContain(reason)
  })

  test('não tem valor sem uso, repetido nem fora de ordem alfabética', () => {
    expect([...DOMAIN_REASONS]).toEqual([...new Set(DOMAIN_REASONS)].sort())
    expect([...DOMAIN_REASONS].sort()).toEqual([...usados()].sort())
  })

  test('customer_gone faz parte da lista e o erro guarda o reason', () => {
    expect(DOMAIN_REASONS).toContain('customer_gone')
    expect(new DomainError('conflict', 'x', { reason: 'customer_gone' }).reason).toBe('customer_gone')
  })
})
