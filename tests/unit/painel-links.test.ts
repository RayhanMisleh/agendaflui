import { arquivosCom } from '../setup/varredura'

// Todo caminho interno escrito nas telas do painel começa com /painel (ou é da área: /conta, /entrar, /arquivos).
const RE = /(href=\{?\s*|redirect\(\s*|router\.(?:push|replace)\(\s*|fetch\(\s*|action=\{?\s*)['"`]\/(?!painel\b|conta\b|entrar\b|arquivos\/)/

test('nenhum link interno do painel fora de /painel', () => {
  expect(arquivosCom(RE, ['src/app/app/painel'])).toEqual([])
})

test('as seções do painel nunca aparecem como caminho sem o prefixo /painel', () => {
  const secoes = /['"`]\/(agenda|clientes|equipe|servicos|fidelidade|banners|loja|relatorios|configuracoes)(?=[/?'"`$#])/
  expect(arquivosCom(secoes, ['src/app/app/painel', 'src/ui'])).toEqual([])
})
