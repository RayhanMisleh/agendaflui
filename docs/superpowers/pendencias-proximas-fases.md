# Pendências para as próximas fases

> Documento de trabalho, apagado no fechamento do projeto junto com a spec e os planos.
> Cada item veio de uma revisão da Fase 1 e foi triado pela revisão final.

## Fase 2 (agenda e API) — começar por aqui

- `TenantContext` (`src/server/auth/actor.ts`): incluir o `db` da conta criado uma vez por requisição (hoje cada `tenantDb()` cria um `$extends`), dados de auditoria (ip, "em nome de") e os atores `customer` e equipe via API.
- `Business` dentro de `tenantDb`: lista de campos que o domínio pode alterar (hoje alcança `status`, `internalNotes`, `slug`, `timezone`; só o painel dev deveria).
- Toda tabela nova de conta: classificar em `models.ts`, `business_id`, FK composta com `business_id` e `ON UPDATE NO ACTION` (o teste estrutural confere).
- Limitador de login: levar para o banco, limite por chave e por IP; ao passar do teto, não descartar primeiro as chaves bloqueadas; filtrar `x-forwarded-for` antes de usar o IP.
- `tenantDb`: tratar P2025 como "não encontrado" no domínio; `_count: true` em `Business` é recusado (entra em `sessions`); conferir a API fluente do Prisma (`findUnique(...).user()`) com banco.
- Mover `src/ui/theme/derive.ts` e `color.ts` para um módulo neutro antes da rota `business` da API (hoje o servidor importa de `ui/`).
- `APP_SECRET`: quando passar a assinar JWT ou cifrar segredos, recusar o valor de exemplo em produção.
- Trava de data: não pega `new Date(1 + texto)` nem apelido de `Date`.
- `test:tz` roda só `time.test.ts`: estender para a suíte de agenda.
- Banco de teste recriado a cada execução; `proxy()` sem teste automatizado; `areaUrl` sem validar barra inicial; teste da inversa do módulo de tempo só com instante de julho.

## Fase 3 (painel dev)

- `canonicalTimeZone` ao gravar o fuso da conta (hoje aceita minúsculas e `UTC`).
- Vitrine atrás de `requirePlatformAdmin`.
- Uploads: limpar `.meta`/`.tmp` quando o `put` falha no meio; rota de arquivos decodifica segmentos possivelmente já decodificados; links simbólicos; testes de símbolo pequeno e de GPS; detecção de "pixel limit" por texto.
- Prévia da personalização: avisar quando o relevo da capa colapsa em cores extremas.
- Molduras: `symbolUrl` nunca aparece; faixa de suporte com a coluna grudada (o `top` deve considerar a altura da faixa); logo em baixo-relevo e faixa de suporte na vitrine.
- `LoginForm` compartilhado mora em `painel/`; novo login não revoga a sessão anterior do navegador.
- Testes: token de admin no teste "só o hash"; contorno do limitador por maiúsculas; teste sem JavaScript na entrada do painel do negócio.

## Fase 4 (painel do negócio)

- Dados públicos de usuário (nome, e-mail, avatar) para telas de equipe: helper em `src/server/auth`, porque `tenantDb` bloqueia `User`.
- `DataList`: limite tabela ↔ cartões por instância (36rem é único hoje); células renderizadas duas vezes (ids duplicados, interativo dentro de interativo).
- `Toast`: região viva reaberta a cada mudança; fica sob um diálogo aberto depois.
- `Tabs` com `href` deveriam ser navegação com `aria-current`; abas a 375 px sem pista de rolagem; aba inativa descola 1 px no hover.
- `Dialog` intercepta Esc de filhos; anel de foco depende do contêiner (papel dentro de capa, `Checkbox` sobre capa); halo de texto duplicado em `base.css` e `feedback.css` e pesado em texto primário.
- Molduras: título `h2` dentro de `h2` quando embutidas; barra da base do celular deixa de grudar se um ancestral tiver `overflow`; falta teste da barra grudada no meio da rolagem.
- Papel e termos da conta calculados em dois lugares (`page.tsx` e `PainelFrame.tsx`); texto "Você entra como Dono".

## Fase 6 (fechamento e produção)

- Postgres atrás de PgBouncer em modo transaction pode ignorar `options -c timezone=UTC`: conferir a sessão em UTC contra a URL de produção.
- Banco embutido escutando só em 127.0.0.1; parar o banco quando um passo posterior ao start falha; handlers de sinal do `scripts/dev.ts` desde o início.
- Padrões de host em quatro lugares (proxy, env, `dev.ts`, Playwright): extrair `hostConfigFromEnv`.
- CSP completa com nonce, HSTS, cookies com prefixo `__Host-`.
- Validar o ambiente na partida (`instrumentation.ts`), não na primeira requisição.
- Falha de disco na rota de arquivos vira 404 sem registro; "GET / 404" no log quando uma action redireciona atrás do proxy; teste automatizado dos cabeçalhos de `/arquivos` com o servidor rodando.

## Para o dono decidir (visual)

- Esmalte ficou mais liso que os outros materiais.
- Couro em cor clara parece salpicado.
- Contorno do nome em baixo-relevo pesado com a fonte arredondada (tela de escolher conta).
- Carimbo ou lâmpada para a situação na lista de contas do painel dev.
- Elástico na tela de entrada e parafusos no painel dev (acrescentados por iniciativa do implementador).
