import { arquivosCom } from '../setup/varredura'

// O termo padrão de toda conta é "Cliente(s)": nenhum arquivo do código, do seed ou dos scripts fala em "tutor".
test('nenhum arquivo de src, prisma e scripts cita tutor', () => {
  expect(arquivosCom(/tutor/i, ['src', 'prisma', 'scripts'], ['src/server/db/generated'])).toEqual([])
})
