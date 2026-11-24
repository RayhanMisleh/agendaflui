# Arquitetura

Um projeto Next.js 16 (TypeScript estrito, Prisma 7, PostgreSQL) que serve três endereços. A spec com as decisões de
produto está em `docs/superpowers/specs/2026-11-13-agendaflui-design.md`; as regras de tempo, em `docs/TEMPO.md`.

## Três hosts

`DEV_HOST`, `PAINEL_HOST` e `API_HOST` vêm do ambiente (nunca fixos no código). `hostConfigFromEnv` e `DEFAULT_HOSTS`
(`src/server/hosts.ts`) são a única leitura deles: `env.ts`, o proxy, `scripts/dev.ts` e o Playwright a usam.

| Host | Quem usa | Pasta em `src/app/` |
|---|---|---|
| Painel dev | admins da plataforma | `dev/` |
| Painel do negócio | donos, gerentes e profissionais | `painel/` |
| API | o aplicativo | `api/v1/` |

`src/proxy.ts` lê o cabeçalho `Host` (nunca `X-Forwarded-Host`) e chama `routeRequest`: reescreve `/x` para `/<área>/x`,
deixa passar `/_next`, `/brand`, `/arquivos` e `/healthz` (este em qualquer host) e responde 404 a host desconhecido ou a
caminho que já comece com o nome de uma área. O proxy do servidor precisa preservar o `Host`; as rotas POST do painel dev
conferem `Origin == Host`.

## Camadas

- `src/app/` rotas e telas (Server Components e Server Actions). Fina: autentica, valida a entrada e chama o domínio.
  `_lib/` guarda o apoio das telas; `healthz/` e `arquivos/` (imagens enviadas) atendem em todos os hosts.
- `src/server/domain/` toda a regra de negócio, por assunto: `scheduling`, `catalog`, `customers`, `team`, `settings`,
  `reports`, `notifications` (fila), `loyalty`, `banners`, `store`, `platform` (painel dev) e `account`.
  Cada função recebe `ctx` (conta, ator, `ctx.db`, `ctx.clock()`); nunca usa o cliente Prisma cru nem `new Date()`.
  Erros são `DomainError` (`domain/errors.ts`), que também exporta o `z` usado nos esquemas.
- `src/server/auth/` sessões, senhas, papéis e capacidades (`capabilities.ts`), tokens do app, limites de taxa, suporte.
- `src/server/db/` cliente Prisma, `tenantDb` (`tenant.ts`), classificação dos modelos (`models.ts`), retenção, saúde.
- `src/server/api/` camada HTTP da API: `defineRoute`, validação, erros, CORS, uso, contrato e o OpenAPI gerado.
- `src/server/{time,integrations,notifications,storage}/` tempo, provedores externos, fila de avisos e arquivos.
- `src/ui/` design system (componentes, molduras, temas, estilos); `src/shared/` código sem servidor (módulos, tema).
  A marca vem do repositório `branding/`; os tokens ficam em `src/ui/theme` e `src/shared/theme`.

O ESLint impõe as fronteiras: cliente Prisma cru só em `src/server/db`, `auth`, `notifications`, `domain/platform`, `prisma`, `scripts` e
`tests`; rotas não importam `tenantDb`; `new Date(texto)` e os métodos locais de data são proibidos fora de `src/server/time/`.

## Isolamento entre contas

Cada negócio é uma conta (`businesses`). Os modelos são classificados em `src/server/db/models.ts` (de conta,
de conta opcional, de plataforma ou o próprio registro da conta).

- `tenantDb(businessId)` (`src/server/db/tenant.ts`) é o único caminho para dados de conta: filtra por `businessId` em toda
  leitura, alteração e exclusão, grava a conta no `create`, recusa escrita aninhada, SQL cru e modelos de plataforma
  (inclusive por relação, em `include`, `where` e `orderBy`).
- No banco, toda tabela de conta tem `business_id` e as relações entre elas usam FK composta com `business_id`: uma linha
  nunca aponta para outra conta. `tests/integration/schema.test.ts` confere a estrutura e falha para tabela nova sem
  classificação ou sem FK composta.
- Tabela nova: classifique em `models.ts`; migrações com índices parciais e FKs compostas são geradas pelo diff de
  schema para schema (o schema Prisma não os expressa).

## Acesso e papéis

- **Painel dev**: administradores da plataforma (`platform-auth.ts`, sessão de 12 h). Criam contas, ligam módulos,
  configuram integrações e veem métricas, uso, auditoria e o estado do sistema (`/sistema`).
- **Painel do negócio**: membros da conta (`member-auth.ts`, sessão de 30 dias, uma loja por login da equipe: o banco recusa um segundo vínculo ativo do mesmo usuário). Papéis
  `OWNER`, `MANAGER` e `PROFESSIONAL` mapeiam para capacidades (`can()` em `capabilities.ts`); o domínio chama `authorize`.
  A conta sempre mantém ao menos um dono ativo. A equipe entra por um endereço único (`/entrar`); a loja vem do vínculo ativo da pessoa. No app, `POST /v1/auth/staff/login` também não leva `X-Business`: a resposta traz a loja (`business`), e as outras rotas da equipe seguem com o `slug` dela.
- **Suporte** ("entrar como", `support-session.ts`): o admin troca um token de passagem (60 s, uso único) por uma sessão de
  60 minutos fixos no painel do negócio, com poderes de dono, exceto gerir acessos da equipe. Admin ou conta inativos derrubam a
  sessão na requisição seguinte. As ações ficam na auditoria.
- **API do app** (`/v1`, `define-route.ts`): serve só aos apps próprios (web, iOS e Android), sem chave de API. Toda rota
  declara o tipo de autenticação (`none`, `guest`, `guest_or_customer`, `customer`, `staff`). Fora `none`, a conta vem do
  cabeçalho `X-Business` (`auth/api-business.ts`); `customer` e `staff` exigem também o token de acesso (JWT de 15 min) e o de
  renovação (60 dias, rotacionado, só o hash no banco) de `auth/api-tokens.ts`. No navegador, só as origens de
  `APP_WEB_ORIGINS` recebem CORS (`api/cors.ts`; localhost só fora de produção), e o `returnUrl` do checkout segue a mesma
  lista. Limites de taxa por IP (e por cliente ou vínculo nas rotas com `limitBy: 'subject'`) ficam no banco
  (`rate-limit-db.ts`). Cada rota alimenta o uso por conta, rota e hora (`api/usage.ts`). O contrato é o OpenAPI de `/v1/openapi.json`,
  gerado das mesmas definições de rota (`api/openapi.ts`). Criações aceitam `Idempotency-Key`.

## Módulos

Três módulos opcionais por conta (`src/shared/modules.ts`): `loyalty` (fidelidade), `banners` e `store` (loja). O admin os liga na aba Módulos do painel dev (`business_modules`). Cada função de domínio do módulo chama
`requireModule` (`domain/modules.ts`), que lança `module_disabled`; na API vira 404 e a interface esconde o menu. Desligar
guarda os dados. A capacidade `manage_*` correspondente controla quem edita.

## Integrações e segredos

Mercado Pago (pagamento), Frenet (frete) e ViaCEP (CEP) ficam em `src/server/integrations/`, escolhidos por
`INTEGRATIONS_MODE` (`real` ou `fake`; produção só `real`). Os tokens por conta ficam cifrados (`auth/secret-box.ts`: AES-256-GCM,
chave derivada do `APP_SECRET`, conta e campo autenticados junto). Só o admin os grava. A leitura em texto puro passa pelo
leitor restrito `domain/platform/integration-secrets.ts`, que só `domain/store/**` pode importar (o arquivo mora em `domain/platform`, e o resto de `domain/platform` não o importa)
(ESLint e `tests/unit/integration-secrets-imports.test.ts`). O texto puro nunca vai para tela, API, log ou auditoria; as telas
mostram só os 4 últimos caracteres. O webhook do Mercado Pago é `POST /v1/webhooks/mercadopago/{chave da conta}`: a chave
secreta da URL identifica a conta e o estado do pagamento vem sempre da consulta à API do provedor.

## Travas

Concorrência no mesmo registro é serializada por travas de transação do Postgres, sempre pela **função única**
`$lockKey(escopo, id)` do `tenantDb` (`pg_advisory_xact_lock` sobre `conta:escopo:id`; só dentro de `$transaction`). O domínio de
plataforma, que usa o cliente cru, tem `lockKeyRaw` (`db/tenant.ts`) com a mesma chave. Escopos permitidos: `professional`,
`customer`, `membership`, `business_owners`, `catalog`, `loyalty`, `banners`, `store`, `order`. A única exceção é a trava global dos
admins da plataforma (`travarAdmins` em `domain/platform/admins.ts`, `pg_advisory_xact_lock` sobre `platform_admins`), que não
pertence a nenhuma conta e por isso não cabe em `conta:escopo:id`. Para nunca esperar em círculo (deadlock 40P01), a ordem é:

- Acesso (convite, papel, desativação, redefinição de senha, login do app): `business_owners` da conta, depois os vínculos em
  ordem crescente de id, depois a linha do usuário, depois tokens e sessões (`lockUserAccess` em `auth/password-reset.ts`).
- Pessoa e loja (cadastro, entrada pela loja, adoção, Google): `lockUserAccess` da pessoa primeiro, depois `customer` da loja.
- Agenda (`lockedTransaction`, `scheduling/placement.ts`): o cliente primeiro, depois os profissionais em ordem crescente de id.
- Remover profissional (`removerProfissional`, `access-core.ts`): acesso primeiro (`business_owners`, vínculos), depois `professional`.
- Escopos sozinhos, sem combinar com outros: `catalog`, `loyalty`, `banners`, `customer` (resgate, ajuste, endereço, conta do
  app) e `membership` (login e renovação do app). `store` também trava sozinho em produtos e categorias.
- Loja: criar pedido trava `store` e reserva o estoque; cancelar, vencer e estornar travam `order` e devolvem. As linhas de
  produto são sempre travadas em ordem de id. Nunca `store` e `order` juntos.

## Fila de avisos e agendador interno

Avisos (e-mail e push) entram em `notifications` na mesma transação do fato que os gerou
(`domain/notifications/outbox.ts`). Dono e gerente podem ligar, no app (`PATCH /v1/staff/me`), os avisos de toda a loja: linhas só de push, marcadas `audience: 'watcher'`, que o envio confere de novo contra o papel e a preferência. O envio (`src/server/notifications/`) reserva linhas com `FOR UPDATE SKIP LOCKED` por 2
minutos (`claim.ts`), decide, renderiza e entrega por canal (`channels/`: SMTP e Expo; arquivos em `.local/` em
desenvolvimento), com até 5 tentativas e espera crescente. A garantia é "pelo menos uma vez".

`scheduler.ts` sobe com o servidor (`src/instrumentation.ts`; desliga com `WORKER_ENABLED=false`) e roda em qualquer número de
instâncias. Cada execução é gravada em `scheduler_runs` e aparece em `/sistema`. Tarefas: `notifications` (a cada minuto),
`store` (varredura de pedidos vencidos e conferência no Mercado Pago), `calendar` (envio ao Google Agenda, a cada minuto),
`cleanup` (sessões, códigos e limites vencidos, a cada hora) e `retention` (diária: avisos terminados com mais de 90 dias,
uso da API com mais de 400, auditoria com mais de 2 anos; `src/server/db/retention.ts`, em lotes). `npm run worker:once` roda
uma rodada de avisos e termina.

### Google Agenda (só enviar)

Cada agendamento tem uma linha em `calendar_syncs` com `generation` (sobe a cada mudança, na mesma transação do agendamento, em
`afterChange` e nos pontos de `domain/calendar/queue.ts`; nunca chama o Google nem lê ligação) e `synced_generation`. A tarefa
`calendar` do agendador (`src/server/calendar/worker.ts`) reserva as linhas atrasadas (`claim.ts`, `FOR UPDATE SKIP LOCKED`), lê o
estado atual e deixa o Google igual a ele: evento com id determinístico `af<uuid sem hífens>` (PUT e, se não existe, POST); cancelado
e falta apagam. Repetir é inofensivo; mudança durante o envio só sobe a geração e a linha volta na rodada seguinte. Falha do Google
espera 1, 5, 15, 60 e 240 min e na 6ª para (`failed_at`; uma mudança nova a revive); 429 espera 1 min sem contar; token recusado vira
`REVOKED` em `calendar_connections`. O token de renovação fica selado por pessoa (`calendar/token.ts`, leitor restrito: só
`src/server/calendar/**` o importa; ESLint e `tests/unit/calendar-token-imports.test.ts` conferem). Nenhuma trava nova: o
enfileiramento roda sob as travas da operação que o chama.

## Arquivos

Imagens enviadas (logo, fotos da equipe, banners, produtos) passam por `storage/images.ts` (valida e recodifica) e
vão para a interface `Storage` (`storage/storage.ts`), hoje em disco (`local-disk.ts`) em `STORAGE_DIR`; produção usa um
volume persistente. São servidas por `GET /arquivos/{chave}` em qualquer host, com cabeçalhos de segurança.

## Saúde e partida

`GET /healthz` consulta o banco (503 se não responder em 2 s). `scripts/start-production.ts` valida o ambiente, espera o banco,
confere fuso e travas, aplica as migrações e inicia o Next; detalhes em `docs/PUBLICACAO.md`.
