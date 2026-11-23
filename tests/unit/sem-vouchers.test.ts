import { arquivosCom } from '../setup/varredura'

// Varre o código: nenhuma menção a voucher nas telas, na API e no manifesto de rotas.
const PASTAS = ['src/app/painel', 'src/app/api', 'src/ui', 'src/server/api/routes-manifest.ts']
const EXCETO = ['src/app/api/v1/store'] // a loja muda junto com o domínio, na Task 2

test('nenhum arquivo das pastas varridas cita voucher', () => {
  expect(arquivosCom(/voucher/i, PASTAS, EXCETO)).toEqual([])
})
