# Arquitetura

Um projeto Next.js 16 (TypeScript estrito, Prisma 7, PostgreSQL) que serve dois endereços. A spec do produto atual está em
`docs/superpowers/specs/2026-11-23-app-unico-pet-design.md` (a base de agenda, em `2026-11-13-agendaflui-design.md`); as regras de tempo, em `docs/TEMPO.md`.

## Hosts

`DEV_HOST` e `APP_HOST` vêm do ambiente (nunca fixos no código); `LEGACY_PAINEL_HOST` é opcional. `hostConfigFromEnv` e
`DEFAULT_HOSTS` (`src/server/hosts.ts`) são a única leitura deles: `env.ts`, o proxy e `scripts/dev.ts` a usam.

| Host | Quem usa | Pasta em `src/app/` |
|---|---|---|
| `DEV_HOST` (painel dev) | admins da plataforma | `dev/` |
| `APP_HOST` (Agenda Flui) | donos, equipes e clientes | `app/` |
| `LEGACY_PAINEL_HOST` (opcional) | só redireciona | nenhuma |

Rotas do `APP_HOST`:

| Caminho | O que é |
|---|---|
| `/` | decide o destino da pessoa (`auth/destination.ts`) |
| `/entrar`, `/esqueci-a-senha`, `/redefinir-senha/<token>`, `/convite/<token>` | entrada da pessoa, convite e senha por link |
| `/painel/**` | painel da loja (equipe) |
| `/<slug>`, `/<slug>/entrar`, `/<slug>/cadastro` | área do cliente da loja |
| `/conta` | Minha conta (senha, Google, e-mail) |
| `/google/entrar`, `/google/retorno` | Entrar com Google (`/google/falso` só com `INTEGRATIONS_MODE=fake`) |
| `/suporte/<token>` | passagem do "entrar como" do admin |
| `/webhooks/mercadopago/<chave>` | webhook do Mercado Pago |
| `/arquivos/**`, `/brand/**`, `/healthz` | arquivos enviados, marca e saúde |

Os nomes de rota do sistema são reservados e nenhuma loja os usa como identificador (`src/shared/reserved-slugs.ts`).

`src/proxy.ts` lê o cabeçalho `Host` (nunca `X-Forwarded-Host`) e chama `routeRequest`: reescreve `/x` para `/<área>/x`
(`dev/` ou `app/`), deixa passar `/_next`, `/brand`, `/arquivos` e `/healthz` (este em qualquer host) e responde 404 a host
desconhecido ou a caminho que já comece com o nome de uma pasta-raiz (`dev` ou `app`: elas não são acessíveis direto). No
`LEGACY_PAINEL_HOST`, `legacyPainelPath` responde 308 para o `APP_HOST` (`/definir-senha/<t>` vira `/convite/<t>`, o resto
vira `/painel/...`; `/entrar`, `/esqueci-a-senha`, `/redefinir-senha`, `/arquivos` e `/brand` mantêm o caminho; `/_next` é 404). O
proxy do servidor precisa preservar o `Host`; as rotas POST do painel dev conferem `Origin == Host`.

## Camadas

- `src/app/` rotas e telas (Server Components e Server Actions). Fina: autentica, valida a entrada e chama o domínio.
  `_lib/` guarda o apoio das telas; `healthz/` e `arquivos/` (imagens enviadas) atendem em todos os hosts.
- `src/server/domain/` toda a regra de negócio, por assunto: `scheduling`, `catalog`, `customers`, `team`, `settings`,
  `reports`, `notifications` (fila), `loyalty`, `banners`, `store`, `platform` (painel dev) e `account`.
  Cada função recebe `ctx` (conta, ator, `ctx.db`, `ctx.clock()`); nunca usa o cliente Prisma cru nem `new Date()`.
  Erros são `DomainError` (`domain/errors.ts`), que também exporta o `z` usado nos esquemas.
- `src/server/auth/` a pessoa e a sessão, senhas, papéis e capacidades (`capabilities.ts`), Google (`google/`), Minha conta, limites de taxa, suporte.
- `src/server/db/` cliente Prisma, `tenantDb` (`tenant.ts`), classificação dos modelos (`models.ts`), retenção, saúde.
- `src/server/{time,integrations,notifications,storage}/` tempo, provedores externos (Mercado Pago, Frenet, ViaCEP e Google), fila de e-mails e arquivos.
- `src/ui/` design system (componentes, molduras, temas, estilos); `src/shared/` código sem servidor (módulos, tema).
  A marca vem do repositório `branding/`; os tokens ficam em `src/ui/theme` e `src/shared/theme`.

O ESLint impõe as fronteiras: cliente Prisma cru só em `src/server/db`, `auth`, `notifications`, `domain/platform`, `prisma`, `scripts` e
`tests`; rotas não importam `tenantDb`; `new Date(texto)` e os métodos locais de data são proibidos fora de `src/server/time/`.

## Nicho e agenda da equipe

- Nicho: o que é do ramo da conta mora no registro `src/server/niches/` (puro) e em tabelas próprias (`pets`, `service_prices`).
  O domínio lê o nicho por `getNicheSettings`; funções do nicho pet chamam `requirePetNiche` (`niche_unavailable`). O nicho não é
  módulo. Elegibilidade, preço e tempo por animal e porte têm uma regra só, em `domain/catalog/pricing.ts`.
- Agenda: o cliente segue todas as regras (grade, folga, expediente, prazos); a equipe marca em qualquer minuto e com duração de 5 a
  720 min. Conflito da equipe volta como `conflict` com `reason: 'needs_confirmation'` e uma impressão (`acknowledged`); repetir o pedido
  com a impressão grava, e o que sobrepõe um normal vira encaixe (`is_squeeze_in`, `scheduling/squeeze-in.ts`). Quando um normal sai,
  os encaixes do intervalo são reavaliados na mesma transação.

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

- **Painel dev**: administradores da plataforma (`platform-auth.ts`, cookie `af_dev_session`, sessão de 12 h). Criam contas, ligam módulos,
  configuram integrações e as chaves do Google e veem métricas, auditoria e o estado do sistema (`/sistema`).
- **A pessoa** (`users`): uma conta por pessoa, com senha e/ou Google, que serve à equipe e aos clientes. Uma sessão única de 30 dias
  (cookie `af_session`, `httpOnly`, `SameSite=Lax`, `Secure` em produção; `auth/session.ts`) vale para o painel e para as lojas em que
  ela é cliente (`customers.user_id`). Depois de toda entrada, `auth/destination.ts` decide para onde ela vai: equipe ativa vai ao
  painel; senão, a loja em que é cliente (a última usada na sessão ou a ligação mais recente); sem nenhuma, a tela "sem loja". O
  banco recusa um segundo vínculo ativo de equipe do mesmo usuário, e o contexto da loja da equipe vem desse único vínculo, relido a
  cada chamada. Painel e área do cliente sempre reconferem o vínculo (nada confia na URL sozinha).
- **Papéis da equipe**: `OWNER`, `MANAGER` e `PROFESSIONAL` mapeiam para capacidades (`can()` em `capabilities.ts`); o domínio chama
  `authorize`. A conta sempre mantém ao menos um dono ativo. Convite e redefinição de senha são por link, para todos.
- **Código de e-mail** (`email_codes`, `auth/email-code.ts`): 6 dígitos, para o cadastro pela loja (`SIGNUP`) e a troca de e-mail
  (`EMAIL_CHANGE`).
- **Google** (OIDC, código + PKCE): `auth/google/` guarda `state`, `nonce` e o verificador no cookie assinado `af_google`, confere o
  `id_token` pelo JWKS e aplica as regras de vínculo na função pura `decideGoogle`, sob trava. As chaves (ID e segredo do cliente)
  são gravadas só pelo admin (`domain/platform/google-settings.ts`, cifradas) e lidas em texto só pelo leitor restrito
  `domain/platform/google-secrets.ts`, que só `src/server/auth/google/**` importa (ESLint e `tests/unit/google-secrets-imports.test.ts`).
- **Suporte** ("entrar como", `support-session.ts`): o admin troca um token de passagem (60 s, uso único) por uma sessão de
  60 minutos fixos no painel do negócio, com poderes de dono, exceto gerir acessos da equipe. Admin ou conta inativos derrubam a
  sessão na requisição seguinte. As ações ficam na auditoria.
- Limites de taxa por IP e por e-mail ficam no banco (`rate-limit-db.ts`).

## Módulos

Três módulos opcionais por conta (`src/shared/modules.ts`): `loyalty` (fidelidade), `banners` e `store` (loja). O admin os liga na aba Módulos do painel dev (`business_modules`). Cada função de domínio do módulo chama
`requireModule` (`domain/modules.ts`), que lança `module_disabled`; a rota vira 404 e a interface esconde o menu. Desligar
guarda os dados. A capacidade `manage_*` correspondente controla quem edita.

## Integrações e segredos

Mercado Pago (pagamento), Frenet (frete) e ViaCEP (CEP) ficam em `src/server/integrations/`, escolhidos por
`INTEGRATIONS_MODE` (`real` ou `fake`; produção só `real`). Os tokens por conta ficam cifrados (`auth/secret-box.ts`: AES-256-GCM,
chave derivada do `APP_SECRET`, conta e campo autenticados junto). Só o admin os grava. A leitura em texto puro passa pelo
leitor restrito `domain/platform/integration-secrets.ts`, que só `domain/store/**` pode importar (o arquivo mora em `domain/platform`, e o resto de `domain/platform` não o importa)
(ESLint e `tests/unit/integration-secrets-imports.test.ts`). O texto puro nunca vai para tela, API, log ou auditoria; as telas
mostram só os 4 últimos caracteres. O webhook do Mercado Pago é `POST /webhooks/mercadopago/{chave da conta}`: a chave
secreta da URL identifica a conta e o estado do pagamento vem sempre da consulta à API do provedor.

## Travas

Concorrência no mesmo registro é serializada por travas de transação do Postgres, sempre pela **função única**
`$lockKey(escopo, id)` do `tenantDb` (`pg_advisory_xact_lock` sobre `conta:escopo:id`; só dentro de `$transaction`). O domínio de
plataforma, que usa o cliente cru, tem `lockKeyRaw` (`db/tenant.ts`) com a mesma chave. Escopos permitidos: `professional`,
`customer`, `membership`, `business_owners`, `catalog`, `loyalty`, `banners`, `store`, `order`. A única exceção é a trava global dos
admins da plataforma (`travarAdmins` em `domain/platform/admins.ts`, `pg_advisory_xact_lock` sobre `platform_admins`), que não
pertence a nenhuma conta e por isso não cabe em `conta:escopo:id`. Para nunca esperar em círculo (deadlock 40P01), a ordem é:

- Acesso (convite, papel, desativação, redefinição de senha, entrada): `business_owners` da conta, depois os vínculos em
  ordem crescente de id, depois a linha do usuário, depois tokens e sessões (`lockUserAccess` em `auth/password-reset.ts`).
- Pessoa e loja (cadastro, entrada pela loja, adoção, Google): `lockUserAccess` da pessoa primeiro, depois `customer` da loja.
- Agenda (`lockedTransaction`, `scheduling/placement.ts`): o cliente primeiro, depois os profissionais em ordem crescente de id.
  A reavaliação de encaixes (`scheduling/squeeze-in.ts`) roda sob as mesmas travas de profissional (nenhuma trava nova). A
  restrição `appointments_no_overlap` vale só entre agendamentos normais; o encaixe (`is_squeeze_in`) fica de fora.
- Remover profissional (`removerProfissional`, `access-core.ts`): acesso primeiro (`business_owners`, vínculos), depois `professional`.
- Escopos sozinhos, sem combinar com outros: `catalog`, `loyalty`, `banners`, `customer` (resgate, ajuste, endereço) e `membership`. `store` também trava sozinho em produtos e categorias.
- Loja: criar pedido trava `store` e reserva o estoque; cancelar, vencer e estornar travam `order` e devolvem. As linhas de
  produto são sempre travadas em ordem de id. Nunca `store` e `order` juntos.

## Fila de e-mails e agendador interno

Os avisos (só por e-mail) entram em `notifications` na mesma transação do fato que os gerou
(`domain/notifications/outbox.ts`). Dono e gerente podem ligar, em Minha conta, os avisos de toda a loja: linhas marcadas
`audience: 'watcher'`, que o envio confere de novo contra o papel e a preferência. O envio (`src/server/notifications/`) reserva
linhas com `FOR UPDATE SKIP LOCKED` por 2 minutos (`claim.ts`), decide, renderiza e entrega (`channels/`: SMTP e Resend; arquivos em
`.local/mail` em desenvolvimento), com até 5 tentativas e espera crescente. A garantia é "pelo menos uma vez".

`scheduler.ts` sobe com o servidor (`src/instrumentation.ts`; desliga com `WORKER_ENABLED=false`) e roda em qualquer número de
instâncias. Cada execução é gravada em `scheduler_runs` e aparece em `/sistema`. Tarefas: `notifications` (a cada minuto),
`store` (varredura de pedidos vencidos e conferência no Mercado Pago), `calendar` (envio ao Google Agenda, a cada minuto),
`cleanup` (sessões, códigos e limites vencidos, a cada hora) e `retention` (diária: avisos terminados com mais de 90 dias e
auditoria com mais de 2 anos; `src/server/db/retention.ts`, em lotes). `npm run worker:once` roda uma rodada de avisos e termina.

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
