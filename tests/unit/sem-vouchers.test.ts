import { arquivosCom } from '../setup/varredura'

// Varre o código: nenhuma menção a voucher fora do código gerado do Prisma e das migrações.
const PASTAS = [
  'src',
  'scripts',
  'prisma/schema.prisma',
  'prisma/seed.ts',
  'prisma/seed-data.ts',
  'tests/unit',
  'tests/integration',
  'tests/setup',
  'README.md',
  'docs/ARQUITETURA.md',
  'docs/PUBLICACAO.md',
  'docs/PRODUTO.md',
  'docs/PENDENCIAS.md',
]
const EXCETO = [
  'src/server/db/generated',
  'tests/unit/sem-vouchers.test.ts',
]

test('nenhum arquivo das pastas varridas cita voucher', () => {
  expect(arquivosCom(/voucher/i, PASTAS, EXCETO)).toEqual([])
})
