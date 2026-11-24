import { arquivosCom } from '../setup/varredura'

// Os termos são fixos (Profissional, Cliente, Pontos, Clube): nada no código, no seed nem nos scripts fala de outro ramo,
// e a personalização de termos por conta não existe mais.
test('nenhum arquivo de src, prisma e scripts cita tutor, tosador ou patinha', () => {
  expect(arquivosCom(/\b(tutor(es)?|tosador(es)?|patinhas?)\b/i, ['src', 'prisma', 'scripts'], ['src/server/db/generated'])).toEqual([])
})

test('nenhum código fala de termos personalizáveis por conta', () => {
  expect(
    arquivosCom(/termProfessional|termCustomer|termPoints|termClub|TermosForm|updateTerms/, ['src', 'scripts', 'prisma/seed.ts', 'prisma/seed-data.ts'], ['src/server/db/generated']),
  ).toEqual([])
})
