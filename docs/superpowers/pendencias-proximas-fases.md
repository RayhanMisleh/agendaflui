# Pendências para as próximas fases

> Documento de trabalho, apagado no fechamento do projeto junto com a spec e os planos.
> Cada item veio de uma revisão da Fase 1 e foi triado pela revisão final.

## Fase 2B (API do app e envio de avisos) — começar por aqui

Vindas da Fase 1:

- `areaUrl` sem validar barra inicial.

Vindas da revisão final da Fase 2A:

- Telefones de demonstração: são fictícios, mas não há faixa reservada no Brasil.
- `details.nearest` do erro de horário ocupado não traz `professionalIds`.
- Motivo do cancelamento: o `cancelReason` escrito pela equipe chega ao cliente; separar motivo público de motivo interno.
- Teto de linhas em `getAgenda`.

## Fase 3 (painel dev)

- `canonicalTimeZone` ao gravar o fuso da conta (hoje aceita minúsculas e `UTC`).
- Vitrine atrás de `requirePlatformAdmin`.
- Uploads: limpar `.meta`/`.tmp` quando o `put` falha no meio; rota de arquivos decodifica segmentos possivelmente já decodificados; links simbólicos; testes de símbolo pequeno e de GPS; detecção de "pixel limit" por texto.
- Prévia da personalização: avisar quando o relevo da capa colapsa em cores extremas.
- Molduras: `symbolUrl` nunca aparece; faixa de suporte com a coluna grudada (o `top` deve considerar a altura da faixa); logo em baixo-relevo e faixa de suporte na vitrine.
- `LoginForm` compartilhado mora em `painel/`; novo login não revoga a sessão anterior do navegador.
- Testes: token de admin no teste "só o hash"; contorno do limitador por maiúsculas; teste sem JavaScript na entrada do painel do negócio.

## Fase 4 (painel do negócio)

- Agenda: `workingMinutes` do resumo não desconta bloqueios; conjunto de profissionais do resumo difere do da agenda em dois casos limite (inativo só com cancelado, inativo só com bloqueio); `occupancy` é limitado a 1 (razão de exibição); a busca de 31 dias não tem teto de linhas (rever com a tela de mês).
- Telefone estrangeiro digitado sem `+` e com 10 ou 11 dígitos é tratado como brasileiro: dica na tela.
- `displayOrder` concorrente de serviços; `isUniqueViolation` de profissionais sem conferir o alvo.
- `createTimeBlock` e `createClosure` devolvem quantos agendamentos existem no intervalo: a tela avisa antes de confirmar.

- Dados públicos de usuário (nome, e-mail, avatar) para telas de equipe: helper em `src/server/auth`, porque `tenantDb` bloqueia `User`.
- `DataList`: limite tabela ↔ cartões por instância (36rem é único hoje); células renderizadas duas vezes (ids duplicados, interativo dentro de interativo).
- `Toast`: região viva reaberta a cada mudança; fica sob um diálogo aberto depois.
- `Tabs` com `href` deveriam ser navegação com `aria-current`; abas a 375 px sem pista de rolagem; aba inativa descola 1 px no hover.
- `Dialog` intercepta Esc de filhos; anel de foco depende do contêiner (papel dentro de capa, `Checkbox` sobre capa); halo de texto duplicado em `base.css` e `feedback.css` e pesado em texto primário.
- Molduras: título `h2` dentro de `h2` quando embutidas; barra da base do celular deixa de grudar se um ancestral tiver `overflow`; falta teste da barra grudada no meio da rolagem.
- Papel e termos da conta calculados em dois lugares (`page.tsx` e `PainelFrame.tsx`); texto "Você entra como Dono".

## Fase 5 (módulos)

- Crédito de pontos na conclusão do atendimento (spec 8.3): pendurar no ponto único de eventos do agendamento (`afterChange`), uma vez só por agendamento.

## Fase 6 (fechamento e produção)

- Horário de verão: no dia de 25 horas o cálculo de horários livres esconde alguns horários bons, e no de 23 horas pode oferecer início fora da grade; cobrir com teste (Lisboa e Nova York) e decidir se corrige.
- Espera da trava por profissional segura uma conexão do pool por até 15 s: observar em carga e dimensionar o pool.
- `tsx --conditions=react-server` vale para o processo inteiro do seed e do `dev`: se o domínio passar a importar `react-dom/server`, separar `createTenantContext` de `server-only`.
- Migrações: índices parciais e FKs compostas não existem no schema Prisma; gerar sempre o diff de schema para schema. Afirmar o nome do CHECK nos testes negativos do schema.

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
