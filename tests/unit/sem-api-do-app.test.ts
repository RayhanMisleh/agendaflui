import { arquivosCom } from '../setup/varredura'

// O Agenda Flui é só web: nenhum rastro da API do aplicativo, do push ou dos hosts antigos.
const RE =
  /API do (app|aplicativo)|Requisições à API|Usuários do app|api\.agendaflui|(?<!LEGACY_)PAINEL_HOST|API_HOST|APP_WEB_URL|APP_WEB_ORIGINS|EXPO_ACCESS_TOKEN/

test('nenhum rastro da API do app em código, scripts, docs e ambiente', () => {
  const achados = arquivosCom(
    RE,
    ['src', 'scripts', 'prisma', 'docs/ARQUITETURA.md', 'docs/PUBLICACAO.md', 'docs/PRODUTO.md', 'docs/PENDENCIAS.md', 'README.md', 'AGENTS.md', '.env.example', 'Dockerfile'],
    ['src/server/db/generated', 'prisma/migrations'],
  )
  expect(achados).toEqual([])
})

test('nenhum texto fala do aplicativo nativo: o produto é o endereço da web', () => {
  const achados = arquivosCom(/pelo aplicativo|[Bb]aixe o app|App Store|Google Play/, ['src'], ['src/server/db/generated'])
  expect(achados).toEqual([])
})
