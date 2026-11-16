# Pendências para as próximas fases

> Documento de trabalho, apagado no fechamento do projeto junto com a spec e os planos.
> Cada item veio de uma revisão da Fase 1 e foi triado pela revisão final.

## Fase 2B (API do app e envio de avisos) — começar por aqui

Vindas da Fase 1:

- Limitador de login: levar para o banco, limite por chave e por IP; ao passar do teto, não descartar primeiro as chaves bloqueadas; filtrar `x-forwarded-for` antes de usar o IP.
- Mover `src/ui/theme/derive.ts` e `color.ts` para um módulo neutro antes da rota `business` da API (hoje o servidor importa de `ui/`).
- `APP_SECRET`: quando passar a assinar tokens ou cifrar segredos, recusar o valor de exemplo em produção.
- `proxy()` sem teste automatizado; `areaUrl` sem validar barra inicial.

Vindas da revisão final da Fase 2A:

- Cadastro de cliente pelo app: hoje `createCustomer` exige equipe e grava `origin: PANEL`. Falta o cadastro com senha e confirmação de e-mail, e o fluxo de "assumir" um cadastro feito no balcão com o mesmo e-mail (hoje dá `email_taken`).
- `createCustomerContext`: conferir que o `customerId` do token existe, é da conta e não está arquivado nem anonimizado, a cada requisição.
- Ator `system`: hoje não opera agendamentos. O envio de avisos e tarefas automáticas precisam de um caminho próprio, com cliente cru e `FOR UPDATE SKIP LOCKED`, numa pasta liberada no ESLint (`src/server/notifications/`).
- Envio confere tudo antes de mandar: situação atual do agendamento (avisos de "pedido recebido" e "confirmado" pendentes sobrevivem a cancelar e remarcar), cadastro do cliente, preferências `notify_*`, vínculo ativo do membro; descarta avisos de agendamentos passados (o seed deixa cerca de 70). Para o membro do profissional novo, numa troca feita pelo cliente, o texto é de "novo agendamento".
- Canal de desenvolvimento simulado (grava em `.local/mail`, sem push real): os telefones de demonstração são fictícios, mas não há faixa reservada no Brasil.
- Anonimização completa: apagar tokens de renovação, dispositivos e códigos de verificação do cliente.
- View do agendamento para o cliente traz o prazo de cancelar e remarcar já calculado (instante e rótulo); o app não faz conta de hora.
- "Dias com horário livre num intervalo", para o calendário do app não fazer uma chamada por dia.
- Erros para HTTP: `reason` como tipo fechado (vai para o OpenAPI); `details.nearest` com instantes serializados e `professionalIds`.
- `source` do agendamento é decidido pelo tipo de ator: equipe usando a API grava `PANEL`. Decidir se a origem deve ser o canal (app × painel).
- Separar observação escrita pelo cliente de observação interna da equipe, e motivo público de motivo interno do cancelamento (hoje o cliente escreve `notes` ao marcar e não lê de volta; `cancelReason` da equipe chega ao cliente).
- Limite de taxa em disponibilidade e marcação; teto de linhas em `getAgenda`.
- Testes negativos do aviso ao profissional antigo na troca de profissional.

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
