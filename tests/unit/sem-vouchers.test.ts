import { arquivosCom } from '../setup/varredura'

// Varre o código: nenhuma menção a voucher fora do banco (src/server/db/models.ts e
// tests/integration/schema.test.ts saem na Task 3, junto com a migração).
const PASTAS = [
  'src',
  'scripts',
  'prisma/seed.ts',
  'prisma/seed-data.ts',
  'tests/unit',
  'tests/integration',
  'tests/setup',
  'README.md',
  'docs/ARQUITETURA.md',
  'docs/PUBLICACAO.md',
]
const EXCETO = [
  'src/server/db/generated',
  'src/server/db/models.ts',
  'tests/unit/sem-vouchers.test.ts',
  'tests/integration/schema.test.ts',
]

test('nenhum arquivo das pastas varridas cita voucher', () => {
  expect(arquivosCom(/voucher/i, PASTAS, EXCETO)).toEqual([])
})
