# Fase 1 (Base) — endereço único, pessoa única e Google — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `app.agendaflui.com.br` passa a servir entrada, painel da loja (`/painel/**`) e a base da área do cliente (`/<slug>`), com uma conta por pessoa (senha e/ou Google), destino decidido pelo cadastro, Minha conta, chaves do Google no dev, e sem API do app, push e termos personalizáveis.

**Architecture:** Quatro passos que se apoiam: (1) host único `app` e limpeza (API, push, uso, termos), com o painel movido para `src/app/app/painel/**`; (2) a pessoa no banco (`users` ganha Google e verificação, `customers.user_id`, códigos de e-mail de plataforma), sessão única de 30 dias e a função de destino; cadastro e entrada pela loja, convite e senha por link para todos; (3) Google OIDC (código + PKCE, `state`/`nonce` num cookie assinado) com as regras 1–11 numa função pura `decideGoogle` aplicada sob trava; (4) Minha conta. Toda regra de pessoa mora em `src/server/auth/` (onde o Prisma cru é permitido); o domínio de conta continua por `tenantDb`.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, TypeScript estrito, Prisma 7 + PostgreSQL (SQL à mão), `jose` 6 (JWT do cookie de fluxo e verificação do `id_token` por JWKS), `@node-rs/argon2`, Vitest + Postgres embutido. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-23-app-unico-pet-design.md` (manda em tudo; esta é a fase 1 de 4). Regras: `AGENTS.md`. Travas: `docs/ARQUITETURA.md` ("Travas"). Mapa do código (só fatos, pode estar velho): `.superpowers/codemap-2026-11-23.md`.

## Global Constraints

Copiado da spec (literal):
- "Regras do projeto (`AGENTS.md`): domínio só em `src/server/`, `tenantDb`, `ctx.clock()`, `z` de `@/server/domain/errors`, tempo por `src/server/time/`, travas por `$lockKey` na ordem de `docs/ARQUITETURA.md`, segredos só por leitor restrito, `requireModule`, tabela nova classificada em `models.ts`, sem `any`."
- "Verificação: `npm run typecheck && npm run lint && npm test && npm run build`. Sem testes de navegador (o dono confere)."
- "Migrações em SQL com transação; produção tem só a conta `demo`."
- "Documentação enxuta: atualizar `ARQUITETURA.md`, `PUBLICACAO.md`, `.env.example`, `README.md` e `AGENTS.md` (hosts), sem histórico."
- "um único cookie de sessão `httpOnly`, `SameSite=Lax`, `Secure`; cabeçalhos de segurança de hoje mantidos; ações e páginas de `/painel/**` sempre reconferem o vínculo de equipe e as de `/[slug]/**` o vínculo de cliente com aquela loja (nada confia na URL sozinha)."
- Nomes reservados: "`entrar, sair, conta, convite, cadastro, esqueci-a-senha, redefinir-senha, definir-senha, google, painel, webhooks, arquivos, brand, healthz, api, dev, admin, www, suporte, app, ajuda, termos, privacidade`".
- Anti-metas: "Qualquer caminho em que a mesma pessoa tenha duas contas, ou em que um Google aponte para uma pessoa e o e-mail dele para outra." / "Uma pessoa ficar trancada fora (sem senha e sem Google) por uma ação dela mesma." / "Nome de loja colidir com rota do sistema." / "Tela crua, sem estado vazio, sem carregamento, sem resposta ao toque; animação que atrapalha ou ignora `prefers-reduced-motion`." / "Texto com "Tutor", "Tosador", "Patinhas" ou termo de outro ramo; rastro de "API do app" nas telas."
- "Movimento com propósito ... Só `transform`/`opacity`; tudo desligado com `prefers-reduced-motion`." / "Toda tela com estado vazio que convida à ação, erro que diz o que fazer, carregamento, foco visível e funcionamento a partir de 360 px de largura."
- Voz: "voz da marca: curta, verbo na frente, "você"". Termos fixos: "Profissional/Profissionais", "Cliente/Clientes", "Pontos", "Clube".

Copiado do `AGENTS.md` (Regras):
- "Regra de negócio só em `src/server/`." / "Dados de conta só por `tenantDb`; o cliente Prisma cru (`@/server/db/client`) fica restrito às pastas liberadas no ESLint." / "Código de domínio (`src/server/domain/**`) recebe `ctx` e usa `ctx.db` e `ctx.clock()`; nunca o cliente Prisma cru nem `new Date()`." / "Esquemas de validação importam `z` de `@/server/domain/errors`, nunca de `zod`." / "Data e hora só por `src/server/time/`." / "Travas de concorrência só pela função única `$lockKey` (`lockKeyRaw` no domínio de plataforma ...)" / "Segredos de integração só pelo leitor restrito `domain/platform/integration-secrets.ts` ..." / "Hosts só por `hostConfigFromEnv` (`src/server/hosts.ts`)." / "Sem `any` e sem `@ts-ignore`." / "Tabela nova: classifique o modelo em `src/server/db/models.ts`. ..."

Do pedido desta fase:
- Convenção de pastas (fixa; as fases 2–4 dependem dela): raiz da área `src/app/app/`; painel em `src/app/app/painel/**` (URL `/painel/**`); entrada em `src/app/app/(entrada)/{entrar,esqueci-a-senha,redefinir-senha/[token],convite/[token]}`; `src/app/app/conta`, `src/app/app/google/{entrar,retorno}`, `src/app/app/suporte/[token]`, `src/app/app/webhooks/mercadopago/[key]`; cliente em `src/app/app/[slug]/**`.
- Migrações novas: pasta nova com timestamp depois de `20261123060000`, SQL à mão com `BEGIN;`/`COMMIT;` e comentários em português; nunca editar migração antiga; índice parcial e CHECK vivem só no SQL (comentário no `schema.prisma`, padrão do arquivo).
- Interface pronta para produção já nesta fase: kit `af-*`, `EntryScreen`, tokens de movimento de `motion.css`, `loading.tsx` com `Skeleton` em toda rota nova com dado, erro com `role="alert"` que diz o que fazer, botão com `loading` no envio, layout sem largura fixa (confere a 360 px). Só a home provisória `/[slug]` é declaradamente temporária.
- Sem Playwright/e2e: não rode nem escreva. Os specs velhos (`tests/e2e/**`, `playwright.config.ts`, script `test:e2e`) são **apagados** na Tarefa 14.
- Verificação por grupo: grupos 1–4 terminam com `npm run typecheck` + os arquivos de teste tocados (`npx vitest run <arquivos>`); o grupo 5 roda a verificação completa.
- Commits locais por tarefa, em português (`tipo: descrição`), terminando com a linha de coautoria do executor. Sem push.

## Review Focus

1. **Mesmo e-mail em corrida** (dois cadastros pela loja, cadastro + Google novo, dois retornos do mesmo Google novo): sempre uma pessoa só; o perdedor recebe "conta existente" ou entra na pessoa criada, nunca uma segunda conta (índices `users_email_key`/`users_google_sub_key` + releitura). Testes nas Tarefas 7 e 11.
2. **Google já vinculado cujo e-mail no Google passou a ser o de outra pessoa**: entra na dona do vínculo (regra 1), atualiza `google_email`, nunca muda de pessoa nem vincula a outra. Teste na Tarefa 11.
3. **Troca de e-mail que colide** (e-mail de outra pessoa, ou de cliente de balcão numa loja da pessoa): recusa clara e nada muda — pessoa e cópias em `customers` mudam juntas na mesma transação ou nenhuma. Teste na Tarefa 12.
4. **Trancar-se fora**: só-Google não desvincula nem troca para e-mail diferente do Google; toda ação de Minha conta mantém senha ou Google. Teste na Tarefa 12.
5. **Links antigos do painel**: `painel.<dominio>/definir-senha/<t>?a=1` → 308 `/convite/<t>?a=1` no `APP_HOST`; `/arquivos/**` preservado; `/_next/**` 404; `/healthz` responde. Teste na Tarefa 2.

## Decisões desta fase (onde a spec cala)

- `Business.segment` **sai agora** (só seed e demo o usam); a fase 2 cria `niche`.
- Códigos de e-mail viram tabela de **plataforma** `email_codes` (propósito `SIGNUP` com `subject` = id da loja, `EMAIL_CHANGE` com `subject` = id da pessoa); `verification_codes` sai.
- Membro da equipe: o contexto da loja vem do **único vínculo ativo** da pessoa, relido a cada chamada; `sessions.active_business_id` fica só para a sessão de suporte.
- Destino com várias lojas e nenhuma "última usada" na sessão: a loja do vínculo de cliente mais recente. Cliente arquivado/anonimizado e loja não ativa não contam. A "última usada" muda só por ação explícita (entrar/cadastrar/usar conta na loja, Trocar de loja).
- Cadastro pela loja com e-mail de conta ativa: a tela segue igual (anti-enumeração, como hoje) e o **e-mail** diz "Este e-mail já tem conta. Entre com ela.".
- Migração: cliente com senha cujo e-mail é de pessoa **pendente** dá à pessoa a senha e a verificação do cliente (senão ela ficaria trancada); pessoa com senha prevalece (spec).
- Troca de e-mail para um e-mail que já é de cliente de balcão numa loja da pessoa: recusada ("Este e-mail já está no cadastro de outro cliente numa loja sua. Fale com a loja.").
- Vínculo de cliente arquivado (ou balcão arquivado com o mesmo e-mail): "entrar na loja" não reativa; mostra "Sua conta nesta loja está desativada. Fale com a loja."
- Avisos de toda a loja (`notifyAllAppointments`) vão por e-mail; a chave fica em Minha conta (dono e gerente). Métrica "Usuários do app" do dev vira "Clientes com conta".
- Legado: além do mapa da spec, `/esqueci-a-senha`, `/arquivos/**` e `/brand/**` vão para o mesmo caminho; `/_next/**` é 404.
- Ambiente de desenvolvimento com `INTEGRATIONS_MODE=fake`: `/google/falso` simula a tela do Google (só nesse modo) para o dono testar no navegador.

## Nota do coordenador antes do deploy (não é tarefa do executor)

Antes de publicar, consultar a produção **só leitura**; se vier linha, parar e perguntar ao dono:

```sql
SELECT slug FROM businesses WHERE slug IN ('entrar','sair','conta','convite','cadastro','esqueci-a-senha','redefinir-senha','definir-senha','google','painel','webhooks','arquivos','brand','healthz','api','dev','admin','www','suporte','app','ajuda','termos','privacidade');
SELECT c.email, count(*) FROM customers c WHERE c.password_hash IS NOT NULL GROUP BY c.email;  -- esperado: 1 (demo)
```

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/reserved-slugs.ts` | Lista única de nomes reservados |
| `src/shared/terms.ts` | `pointsText(n)` ("1 ponto", "2 pontos") |
| `src/shared/person.ts` | `emailChangeUnlinksGoogle` (regra 9, usada pela tela) |
| `src/server/hosts.ts`, `src/proxy.ts`, `src/server/area-links.ts` | Host `dev`/`app`, legado 308, reescrita |
| `src/server/after.ts` | `runAfterResponse` (sai de `server/api`) |
| `src/server/auth/session.ts` | Sessão única da pessoa (ex-`member-auth.ts`) |
| `src/server/auth/destination.ts` | "Para onde a pessoa vai" |
| `src/server/auth/person.ts` | Estado pendente/ativa, ativação, cópias em `customers` |
| `src/server/auth/email-code.ts` | Código de 6 dígitos da pessoa (ex-`verification-code.ts`) |
| `src/server/auth/store-join.ts`, `store-signup.ts` | Entrar/cadastrar pela loja, adotar balcão |
| `src/server/auth/person-account.ts` | Minha conta |
| `src/server/auth/google/{flow,id-token,decide,callback}.ts` | OIDC e regras do Google |
| `src/server/domain/platform/google-settings.ts`, `google-secrets.ts` | Chaves do Google (escrita / leitor restrito) |
| `src/server/integrations/google.ts` (+ `fakes.ts`, `index.ts`) | HTTP do Google atrás de interface |
| `src/app/app/**` | Telas da área única |
| `src/ui/components/{GoogleButton,CodeField}.tsx`, `src/ui/shells/AccountShell.tsx`, `src/ui/styles/conta.css` | Peças novas de interface |
| `tests/setup/migrations.ts` | Banco descartável para testar migração |

## Grupos de execução

| Grupo | Tarefas | Fecha com |
|---|---|---|
| G1 — Endereço único e limpeza | 1, 2, 3, 4 | `npm run typecheck` + testes tocados |
| G2 — Pessoa, sessão e entradas | 5, 6, 7, 8 | idem |
| G3 — Google | 9, 10, 11 | idem |
| G4 — Minha conta | 12, 13 | idem |
| G5 — Docs, demo e verificação | 14 | verificação completa |

---

## G1 — Endereço único e limpeza

### Tarefa 1: API do app sai; host `app` entra

**Files:**
- Delete: `src/app/api/**`, `src/server/api/**` (menos `after.ts`), `src/server/auth/{api-tokens,app-session,staff-app-auth,api-business,api-auth-error}.ts`, `src/server/domain/customers/account.ts`, `src/server/domain/platform/public-business.ts`, `tests/integration/api/**`, `tests/integration/{api-refresh-token,api-schema,appointments-api-shape,customer-account-domain}.test.ts`, `tests/unit/{api-access-token,api-contract,api-cors,api-errors,api-route-types,api-serialize,hosts-api}.test.ts`, `tests/setup/{api,api-scene,access-token}.ts` (antes, confira com `grep` que só esses testes os usam; teste misto perde só os casos de API)
- Move: `src/server/api/after.ts` → `src/server/after.ts`; `src/app/api/v1/webhooks/mercadopago/[webhookKey]/route.ts` → `src/app/app/webhooks/mercadopago/[key]/route.ts` (parâmetro `key`)
- Create: `src/shared/reserved-slugs.ts`
- Modify: `src/server/hosts.ts`, `src/proxy.ts`, `src/server/area-links.ts`, `src/server/env.ts`, `src/server/customer-link.ts`, `src/server/domain/platform/businesses.ts` (slugs e links), todos os chamadores de `areaLink` (lista abaixo), `src/server/domain/store/checkout.ts`, `src/app/painel/(app)/clientes/{Cuidados.tsx,actions.ts}` (tira "Enviar redefinição" até a Tarefa 8), `eslint.config.mjs` (blocos de `src/server/api/**` e `src/app/api/**` saem)
- Test: `tests/unit/hosts.test.ts`, `tests/unit/env.test.ts`, `tests/unit/customer-link.test.ts`, `tests/unit/proxy.test.ts` (novo), `tests/unit/reserved-slugs.test.ts` (novo), `tests/integration/{store-checkout,mercadopago-webhook-route,login-race,payment-review-fixes,painel-password-reset-actions}.test.ts`

**Interfaces:**
- Produces:
  - `src/server/hosts.ts`: `type Area = 'dev' | 'app'`; `type HostConfig = { dev: string; app: string; legacyPainel: string | null }`; `DEFAULT_HOSTS = { dev: 'dev.localhost:3000', app: 'app.localhost:3000' }`; `hostConfigFromEnv(source): HostConfig` (lê `DEV_HOST`, `APP_HOST`, `LEGACY_PAINEL_HOST`; vazio = padrão / `null`); `type RouteDecision = { action: 'rewrite'; to: string } | { action: 'pass' } | { action: 'not_found' } | { action: 'redirect'; path: string }`; `routeRequest(host, pathname, cfg): RouteDecision`; `legacyPainelPath(pathname: string): string | null`; `areaUrl(area, path, cfg, protocol)` (igual).
  - `areaLink(area: Area, path: string): string` (lê `env.DEV_HOST`, `env.APP_HOST`).
  - `RESERVED_SLUGS: readonly string[]` (os 23 da spec, na ordem dela) e `isReservedSlug(slug: string): boolean` em `src/shared/reserved-slugs.ts`.
  - `customerLinkUrl(slug: string): string` = `areaLink('app', '/' + slug)`.
  - `startCheckout(ctx, orderId, i?: { backPath?: string | null })` — `backPath` relativo no app (`/^\/[a-z0-9][a-z0-9/-]{0,199}$/`, sem `//`), vira `areaLink('app', backPath)`; fora disso `validation` com `fields.backPath`.
  - `runAfterResponse`, `setAfterScheduler` em `@/server/after`.

- [ ] **Step 1: Testes que falham** — `tests/unit/hosts.test.ts` reescrito como tabela (`cfg = { dev: 'dev.test', app: 'app.test', legacyPainel: 'painel.test' }`):

```ts
const casos: [string | null, string, RouteDecision][] = [
  ['app.test', '/', { action: 'rewrite', to: '/app' }],
  ['app.test', '/painel/agenda', { action: 'rewrite', to: '/app/painel/agenda' }],
  ['app.test', '/demo', { action: 'rewrite', to: '/app/demo' }],
  ['app.test', '/app/painel', { action: 'not_found' }],
  ['app.test', '/%41pp/x', { action: 'not_found' }],
  ['app.test', '/dev', { action: 'not_found' }],
  ['app.test', '/%E0', { action: 'not_found' }],
  ['dev.test', '/contas', { action: 'rewrite', to: '/dev/contas' }],
  ['dev.test', '/app/x', { action: 'not_found' }],
  ['app.test', '/arquivos/a.png', { action: 'pass' }],
  ['x.test', '/healthz', { action: 'pass' }],
  ['x.test', '/entrar', { action: 'not_found' }],
  ['painel.test', '/', { action: 'redirect', path: '/painel' }],
  ['painel.test', '/entrar', { action: 'redirect', path: '/entrar' }],
  ['painel.test', '/esqueci-a-senha', { action: 'redirect', path: '/esqueci-a-senha' }],
  ['painel.test', '/definir-senha/abc', { action: 'redirect', path: '/convite/abc' }],
  ['painel.test', '/redefinir-senha/abc', { action: 'redirect', path: '/redefinir-senha/abc' }],
  ['painel.test', '/clientes/9', { action: 'redirect', path: '/painel/clientes/9' }],
  ['painel.test', '/arquivos/a/b.png', { action: 'redirect', path: '/arquivos/a/b.png' }],
  ['painel.test', '/_next/static/x.js', { action: 'not_found' }],
  ['painel.test', '/healthz', { action: 'pass' }],
]
```
  mais: com `legacyPainel: null`, `painel.test` → `not_found`. `tests/unit/proxy.test.ts`: `proxy(new NextRequest('http://painel.test/definir-senha/t?a=1', { headers: { host: 'painel.test' } }))` com `APP_HOST=app.test`, `LEGACY_PAINEL_HOST=painel.test` → `status 308`, `location === 'http://app.test/convite/t?a=1'`. `tests/unit/env.test.ts`: produção exige `DEV_HOST` e `APP_HOST` (mensagem cita `APP_HOST: obrigatório em produção (o endereço público, ex.: app.seudominio.com)`), recusa local, iguais entre si, e `LEGACY_PAINEL_HOST` opcional mas, se presente, não local e diferente dos outros; `PAINEL_HOST`, `API_HOST`, `APP_WEB_URL`, `APP_WEB_ORIGINS`, `EXPO_ACCESS_TOKEN` não existem mais no tipo `Env`. `tests/unit/reserved-slugs.test.ts`: `RESERVED_SLUGS` igual ao array literal da spec; sem repetidos; todos passam no formato de slug (3–40, `^[a-z0-9]+(-[a-z0-9]+)*$`); `slugSchema.safeParse('painel')` falha com "reservado pelo sistema". `tests/unit/customer-link.test.ts`: `customerLinkUrl('demo') === 'http://app.localhost:3000/demo'` em teste.
- [ ] **Step 2:** `npx vitest run tests/unit/hosts.test.ts tests/unit/proxy.test.ts tests/unit/env.test.ts tests/unit/reserved-slugs.test.ts tests/unit/customer-link.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** `routeRequest`, na ordem: `/healthz` → `pass`; host = `legacyPainel` (não nulo) → `legacyPainelPath` (`null` → `not_found`, senão `redirect`); host desconhecido → `not_found`; passagem (`/favicon.ico`, `/_next/`, `/brand/`, `/arquivos/`) → `pass`; primeiro segmento decodificado inválido ou igual a `dev`/`app` (os nomes das pastas-raiz) → `not_found`; senão reescreve `/<área><caminho>`. `legacyPainelPath`: `/`→`/painel`; `/entrar`, `/esqueci-a-senha` → iguais; `/definir-senha/<t>` → `/convite/<t>`; `/redefinir-senha/<t>` igual; `/arquivos/**`, `/brand/**` iguais; `/_next/**` → `null`; resto → `/painel<caminho>`. `proxy.ts`: `redirect` → `NextResponse.redirect(areaUrl('app', path + request.nextUrl.search, cfg, process.env.NODE_ENV === 'production' ? 'https' : 'http'), 308)`. `env.ts`: tira as variáveis acima e as funções de origem/URL do app; `NOMES_DOS_HOSTS = ['DEV_HOST','APP_HOST']`; `LEGACY_PAINEL_HOST` opcional com as mesmas regras de forma; tira o aviso de `APP_WEB_ORIGINS`. Chamadores de `areaLink` (caminhos novos): `auth/password-reset.ts` (`/convite/<t>`, `/redefinir-senha/<t>`), `auth/support-session.ts` (`/suporte/<t>`), `domain/platform/access-core.ts` l.346/503 (`/convite/<t>`), l.349 (`/entrar`), l.549 (`/redefinir-senha/<t>`), `domain/platform/businesses.ts` l.381/385 (idem), `src/app/painel/suporte/[token]/route.ts` (`Location: areaLink('app','/painel')`), `storage/images.ts` (`areaLink('app', '/arquivos/…')`), `domain/store/checkout.ts` e `domain/platform/integrations.ts` (`areaLink('app', '/webhooks/mercadopago/<chave>')`). `businesses.ts`: `SLUGS_RESERVADOS` sai; `slugSchema` usa `isReservedSlug`. Rota do webhook: mesmo corpo, `seg.params` → `{ key }`.
- [ ] **Step 4:** Os testes do Step 2 + `npx vitest run tests/integration/store-checkout.test.ts tests/integration/mercadopago-webhook-route.test.ts tests/integration/painel-password-reset-actions.test.ts tests/integration/login-race.test.ts tests/integration/payment-review-fixes.test.ts` → PASS. `npm run typecheck` → só restam erros nos arquivos que a Tarefa 2 apaga (`RefreshToken`/`Device`/push); registre-os.
- [ ] **Step 5: Commit** `refactor: host único do app e fim da API v1`.

### Tarefa 2: Push, aparelhos, tokens do app e métricas de uso saem do banco

**Files:**
- Create: `prisma/migrations/20261123070000_sem_api_e_push/migration.sql`
- Modify: `prisma/schema.prisma` (saem `ApiUsageHourly`, `RefreshToken`, `Device`, `TokenSubject`, `DevicePlatform`, valor `PUSH` de `NotificationChannel`, `Customer.notifyPushAppointments/notifyPushMarketing` e as relações), `src/server/db/models.ts`, `src/server/db/{retention,self-check}.ts`, `src/server/notifications/{scheduler,load,rules,render,worker}.ts`, `src/server/notifications/channels/index.ts`, `src/server/domain/notifications/outbox.ts`, `src/server/domain/settings/notification-settings.ts`, `src/server/domain/customers/{preferences,customers}.ts`, `src/server/domain/team/staff-preferences.ts` (comentário), `src/server/auth/password-reset.ts` (`revokeUserAccess` sem refresh tokens), `src/server/domain/platform/metrics.ts`, `src/instrumentation.ts`, `src/app/dev/(app)/page.tsx`, `src/app/dev/(app)/sistema/page.tsx` (`NOMES_TAREFA` sem `usage_flush`), `src/app/dev/(app)/contas/[id]/FormsConta.tsx` e o formulário de Avisos do painel (só e-mail), `prisma/seed.ts` (sem `writeUsageRows`)
- Delete: `src/server/notifications/channels/{push-expo,push-file}.ts`, `src/server/domain/customers/devices.ts`, `src/server/domain/platform/api-usage.ts`, `tests/integration/devices.test.ts`, `tests/unit/push-channels.test.ts`
- Test: `tests/integration/{outbox,schema,retention,platform-metrics,seed,db-self-check}.test.ts`, `tests/integration/notifications/*.test.ts`, `tests/unit/{notification-settings,notification-render,notification-scheduler,instrumentation,scheduler-runs}.test.ts`

**Interfaces:**
- Produces: `type ChannelToggle = { email: boolean }` (JSON guardado com `push` é ignorado na leitura); `NotificationChannel` só `'EMAIL'`; `Overview` sem `api` nem `appUsers` (a Tarefa 5 acrescenta `customersWithAccount`); `startScheduler` só sobe com `shouldStartWorker` (sem `usage_flush`); avisos de "toda a loja" (`audience: 'watcher'`) saem por e-mail.

- [ ] **Step 1: Testes que falham** — em `tests/integration/outbox.test.ts`: `test('observador (dono com avisos de toda a loja) recebe aviso por e-mail, um por evento')` → linhas com `channel === 'EMAIL'`, `payload.audience === 'watcher'`, dedupe `...:w:<vínculo>`; `test('nenhuma linha de push é criada')`. `tests/unit/notification-settings.test.ts`: `resolveNotificationSettings({ APPOINTMENT_CONFIRMED: { email: false, push: true } })` → `{ email: false }`; patch com `push` é `validation`. `tests/integration/schema.test.ts`: tabelas `api_usage_hourly`, `refresh_tokens`, `devices` não existem; `scheduler_runs_kind_check` recusa `usage_flush`.
- [ ] **Step 2:** rodar esses arquivos → FAIL.
- [ ] **Step 3: Migração** (`20261123070000_sem_api_e_push/migration.sql`):

```sql
-- O Agenda Flui passa a ser só web: saem a API do app (tokens de renovação), os aparelhos de push e as métricas de uso.
BEGIN;
DROP TABLE "api_usage_hourly";
DROP TABLE "refresh_tokens";
DROP TABLE "devices";
DROP TYPE "token_subject";
DROP TYPE "device_platform";
-- Sem push: as linhas de push saem e o canal fica só com e-mail.
DELETE FROM "notifications" WHERE "channel" = 'PUSH';
ALTER TYPE "notification_channel" RENAME TO "notification_channel_antigo";
CREATE TYPE "notification_channel" AS ENUM ('EMAIL');
ALTER TABLE "notifications" ALTER COLUMN "channel" TYPE "notification_channel" USING "channel"::text::"notification_channel";
DROP TYPE "notification_channel_antigo";
ALTER TABLE "customers" DROP COLUMN "notify_push_appointments", DROP COLUMN "notify_push_marketing";
-- O agendador não grava mais as métricas de uso.
DELETE FROM "scheduler_runs" WHERE "kind" = 'usage_flush';
ALTER TABLE "scheduler_runs" DROP CONSTRAINT "scheduler_runs_kind_check";
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_kind_check" CHECK ("kind" IN ('notifications', 'cleanup', 'store', 'retention'));
COMMIT;
```
  Antes de escrever, `grep -n "channel" prisma/migrations/*/migration.sql` para achar índice/CHECK que cite o canal e recriá-lo depois do `ALTER COLUMN`.
- [ ] **Step 4: Código.** Outbox: `CHANNELS = ['EMAIL']`; observador recebe e-mail quando `toggle.email`. `load.ts`: sem `pushTokens`/`allowPush`/`Device`. `render.ts`/`rules.ts`/`worker.ts`: só e-mail. `channels/index.ts`: sai `getPushChannel` e o push de `getChannels`. Dev, Visão geral: a seção "API e avisos nas últimas 24 horas" vira "Avisos nas últimas 24 horas" só com o tile "Avisos na fila"; os tiles "Usuários do app hoje/no mês" saem; `getAccountMetrics` sem `appUsers`. `cleanupRound` sem `purgeRefreshTokens`; `retention.ts` sem `api_usage_hourly`. `instrumentation.ts`: `register` só chama `startScheduler` quando `shouldStartWorker`; `shouldRunInProcess` sai se ficar sem uso. `anonymizeCustomer`: sem `refreshToken`/`device`. Preferências do cliente: só `emailAppointments`/`emailMarketing`.
- [ ] **Step 5:** `npx prisma generate && npm run typecheck` (zero erros agora) e os testes do Step 1 + `tests/integration/notifications tests/unit/notification-scheduler.test.ts tests/unit/instrumentation.test.ts tests/integration/retention.test.ts tests/integration/platform-metrics.test.ts tests/integration/seed.test.ts tests/integration/db-self-check.test.ts` → PASS.
- [ ] **Step 6: Commit** `refactor: sem push, aparelhos, tokens do app e métricas de uso`.

### Tarefa 3: Painel e entrada mudam para `src/app/app/`

**Files:**
- Move (`git mv`): `src/app/painel/(app)/**` → `src/app/app/painel/**` (sem o grupo); `src/app/painel/{EncerrarSuporte,SairDaConta}.tsx`, `src/app/painel/actions.ts` → `src/app/app/painel/_lib/`; `src/app/painel/_marca.ts` → `src/app/app/_lib/marca.ts`; `src/app/painel/entrar` → `src/app/app/(entrada)/entrar`; `src/app/painel/esqueci-a-senha` → `src/app/app/(entrada)/esqueci-a-senha`; `src/app/painel/redefinir-senha` → `src/app/app/(entrada)/redefinir-senha`; `src/app/painel/definir-senha/[token]` → `src/app/app/(entrada)/convite/[token]`; `src/app/painel/suporte/[token]/route.ts` → `src/app/app/suporte/[token]/route.ts`
- Create: `src/app/app/page.tsx` (provisório: `redirect('/painel')`; a Tarefa 6 o substitui), `tests/unit/painel-links.test.ts`
- Modify: `src/ui/shells/painel-nav.ts`, `src/ui/shells/nav.ts`, `src/app/app/painel/_lib/revalidar.ts`, `src/server/auth/guards.ts` (cookie), todo link/redirect/fetch interno do painel, `scripts/smoke-pages.ts`, imports nos testes (`@/app/painel/(app)/…` → `@/app/app/painel/…`, `@/app/painel/entrar/…` → `@/app/app/(entrada)/entrar/…` etc.)
- Test: `tests/unit/{painel-nav,painel-guards,entrada-unica,reserved-slugs}.test.ts`, `tests/integration/painel-*.test.ts`

**Interfaces:**
- Produces: `APP_COOKIE = 'af_session'` (substitui `PAINEL_COOKIE`; `DEV_COOKIE` fica); `setSessionCookie(name: typeof DEV_COOKIE | typeof APP_COOKIE, …)`; `NavItem.exact?: boolean` e `isNavActive(pathname, href, exact?)`; `painelNav` com `href` prefixados (`/painel`, `/painel/agenda`, …; Início com `exact: true`); `atualizarPainel()` = `revalidatePath('/app/painel', 'layout')` (o Next pede o caminho de destino da reescrita).

- [ ] **Step 1: Testes que falham.** `tests/unit/painel-links.test.ts`:

```ts
// Todo caminho interno escrito nas telas do painel começa com /painel (ou é da área: /conta, /entrar, /arquivos).
const RE = /(href=\{?\s*|redirect\(\s*|router\.(?:push|replace)\(\s*|fetch\(\s*|action=\{?\s*)['"`]\/(?!painel\b|conta\b|entrar\b|arquivos\/)/
test('nenhum link interno do painel fora de /painel', () => {
  expect(arquivosCom(RE, ['src/app/app/painel'])).toEqual([])
})
```
  `tests/unit/painel-nav.test.ts`: hrefs com `/painel`; `isNavActive('/painel/agenda', '/painel', true) === false`; `isNavActive('/painel', '/painel', true) === true`. `tests/unit/reserved-slugs.test.ts` ganha: `test('toda pasta de primeiro nível de src/app/app é nome reservado')` — lista `readdirSync('src/app/app')`, ignora `[..]`, `(..)`, `_..` e arquivos, entra nos grupos `(..)`, e exige cada nome em `RESERVED_SLUGS`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Mover e prefixar.** Use `git mv`. Prefixe com `/painel` todo `href`, `redirect`, `router.push`, `fetch` e `action` interno das telas movidas (as rotas de imagem e o CSV de relatórios ficam em `/painel/...`). `requireTenant` continua indo para `/entrar`. Rota de suporte: `setSessionCookie(APP_COOKIE, …)`, `Location: areaLink('app', '/painel')`. `scripts/smoke-pages.ts`: `APP_HOST: app.localhost:<porta>`, páginas do painel com `/painel` na frente, cookie `af_session`.
- [ ] **Step 4:** `npm run typecheck` e `npx vitest run tests/unit/painel-links.test.ts tests/unit/painel-nav.test.ts tests/unit/reserved-slugs.test.ts tests/unit/painel-guards.test.ts tests/unit/entrada-unica.test.ts tests/integration/painel-*.test.ts` → PASS.
- [ ] **Step 5: Commit** `refactor: painel em /painel no host do app`.

### Tarefa 4: Termos fixos, sem `segment`, slugs reservados no banco

**Files:**
- Create: `prisma/migrations/20261123080000_termos_fixos_e_slugs/migration.sql`, `src/shared/terms.ts`, `tests/setup/migrations.ts`, `tests/integration/migration-slugs.test.ts`, `tests/unit/sem-termos-de-outro-ramo.test.ts`
- Delete: `src/server/domain/settings/terms.ts`, `src/app/dev/(app)/contas/[id]/termos/**`
- Modify: `prisma/schema.prisma` (saem as 7 colunas `term*` e `Business.segment`), `src/server/domain/settings/{versioned,business-profile,painel-context}.ts`, `src/server/domain/platform/customization.ts`, `src/server/domain/loyalty/{settings,ledger}.ts`, `src/server/notifications/{load,render}.ts`, `src/server/auth/role-labels.ts` (`roleLabel(role)`), `src/ui/shells/painel-nav.ts`, `src/ui/components/BrandPreview.tsx`, todas as telas que leem `terms` (lista no mapa §4: home, agenda, clientes, equipe, fidelidade, relatórios, serviços, configurações), `src/app/dev/(app)/contas/[id]/{tabs.ts,actions.ts,FormsConta.tsx,marca/*}`, `src/app/dev/(app)/contas/nova/{fields.ts,Wizard.tsx,actions.ts}`, `src/app/dev/vitrine/Vitrine.tsx`, `prisma/{seed.ts,seed-data.ts}`, `scripts/demo-create.ts`, `tests/unit/sem-tutor.test.ts` (absorvido pelo teste novo)
- Test: `tests/unit/{painel-nav,settings-write,dev-wizard,dev-wizard-fields,ui-dev-parts,ui-brand-preview,dev-account-tabs}.test.ts(x)`, `tests/integration/{business-profile,painel-settings-actions,painel-home,dev-account-actions,dev-create-account-action,loyalty-redemptions,seed,notifications/worker,schema}.test.ts`

**Interfaces:**
- Produces: `pointsText(n: number): string` ("1 ponto", "2 pontos", "0 pontos"); `PainelContext = { modules; roleLabel; userName }`; `roleLabel(role: MembershipRole): 'Dono' | 'Gerente' | 'Profissional'`; assistente do dev sem o passo "Termos" (passos: dados, marca, módulos, regras, dono); `tests/setup/migrations.ts`:
  - `withScratchDb(fn: (c: pg.Client) => Promise<void>): Promise<void>` — cria `agendaflui_migr_<aleatório>` no Postgres de teste (`process.env.DATABASE_URL`), conecta, roda `fn`, derruba o banco no `finally`.
  - `applyMigrationsThrough(c: pg.Client, lastName: string): Promise<void>` — lê `prisma/migrations/*/migration.sql` em ordem e aplica até `lastName` inclusive.
  - `applyMigration(c: pg.Client, name: string): Promise<void>`.

- [ ] **Step 1: Testes que falham.** `tests/unit/sem-termos-de-outro-ramo.test.ts`: `arquivosCom(/\b(tutor(es)?|tosador(es)?|patinhas?)\b/i, ['src','prisma','scripts'], ['src/server/db/generated'])` vazio; `arquivosCom(/termProfessional|termCustomer|termPoints|termClub|TermosForm|updateTerms/, ['src','scripts','prisma'], ['src/server/db/generated'])` vazio. `tests/integration/migration-slugs.test.ts`:
  - `test('loja com slug reservado faz a migração falhar com mensagem clara')` — banco descartável até `20261123070000_sem_api_e_push`, insere `businesses(slug='painel', name='X')`, `applyMigration('20261123080000_termos_fixos_e_slugs')` rejeita com mensagem que contém `slug reservado` e `painel`.
  - `test('sem slug reservado a migração passa e o banco recusa slug reservado novo')` — depois de aplicar, `INSERT ... slug='google'` viola `businesses_slug_not_reserved`.
  - `test('o CHECK do banco tem exatamente a lista de RESERVED_SLUGS')` (no banco de teste normal): lê `pg_get_constraintdef` de `businesses_slug_not_reserved`, extrai os literais e compara o conjunto com `RESERVED_SLUGS`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Migração:**

```sql
-- Termos fixos (Profissional, Cliente, Pontos, Clube): saem as colunas de personalização.
-- `segment` sai; o nicho da conta chega na fase 2.
-- Endereço único: nenhuma loja pode usar um nome que é rota do sistema.
BEGIN;
DO $$
DECLARE reservados TEXT;
BEGIN
  SELECT string_agg("slug", ', ') INTO reservados FROM "businesses" WHERE "slug" IN (<os 23 nomes>);
  IF reservados IS NOT NULL THEN
    RAISE EXCEPTION 'Há loja com slug reservado pelo sistema (%); troque o slug antes de aplicar esta migração.', reservados;
  END IF;
END
$$;
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_slug_not_reserved" CHECK ("slug" NOT IN (<os 23 nomes>));
ALTER TABLE "businesses" DROP COLUMN "segment";
ALTER TABLE "business_settings"
  DROP COLUMN "term_professional_singular", DROP COLUMN "term_professional_plural",
  DROP COLUMN "term_customer_singular", DROP COLUMN "term_customer_plural",
  DROP COLUMN "term_points_singular", DROP COLUMN "term_points_plural", DROP COLUMN "term_club";
COMMIT;
```
- [ ] **Step 4: Código.** Telas, avisos, extrato de pontos e o dev passam a usar texto fixo ("Clientes", "Profissionais", "Pontos", "Clube"; contagem por `pointsText`). Somem: seção "Termos" das Configurações do painel, aba "Termos" da conta no dev, passo 3 e presets do assistente, `BrandPreview.terms`. `version` de `business_settings` continua (regras e avisos). Seeds e demo sem termos nem `segment`.
- [ ] **Step 5:** `npx prisma generate && npm run typecheck` e os testes listados → PASS.
- [ ] **Step 6: Commit** `refactor: termos fixos, sem segment e slugs reservados no banco`.

**G1 termina:** `npm run typecheck && npx vitest run <todos os arquivos de teste tocados em 1–4>`.

---

## G2 — Pessoa, sessão e entradas

### Tarefa 5: A pessoa no banco

**Files:**
- Create: `prisma/migrations/20261123090000_pessoa_unica/migration.sql`, `src/server/auth/person.ts`, `tests/integration/migration-pessoa-unica.test.ts`, `tests/integration/person.test.ts`
- Move: `src/server/auth/verification-code.ts` → `src/server/auth/email-code.ts` (reescrita para a tabela nova; o uso vem na Tarefa 7)
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts` (`EmailCode` em `PLATFORM_MODELS`; `VerificationCode` sai), `src/server/db/self-check.ts`, `src/server/domain/customers/customers.ts`, `src/app/app/painel/clientes/{ClienteForm,ClientesTabela,[id]/page}.tsx`, `src/server/domain/platform/metrics.ts`, `src/app/dev/(app)/page.tsx` e `contas/[id]` (tile "Clientes com conta"), `src/server/notifications/scheduler.ts` (`purgeEmailCodes`), `tests/setup/factories.ts`
- Test: `tests/integration/{customers,customers-race,schema,platform-metrics}.test.ts`

**Interfaces:**
- Produces (Prisma):
  - `User`: `phone String?`, `emailVerifiedAt DateTime? @map("email_verified_at")`, `googleSub String? @unique @map("google_sub")`, `googleEmail String? @map("google_email")`, `googleLinkedAt DateTime? @map("google_linked_at")`, `customers Customer[]`.
  - `Customer`: `userId String? @map("user_id") @db.Uuid`, `linkedAt DateTime? @map("linked_at") @db.Timestamptz(3)` (quando a pessoa foi ligada: criação ou adoção), `user User? @relation(fields: [userId], references: [id], onDelete: SetNull)`, `@@unique([businessId, userId])`, `@@index([userId])`; saem `passwordHash`, `emailVerifiedAt`.
  - `Session`: `customerBusinessId String? @map("customer_business_id") @db.Uuid` (relação `customerBusiness Business? @relation("SessionCustomerBusiness", onDelete: SetNull)`; nomeie também a relação existente de `activeBusiness`).
  - `enum EmailCodePurpose { SIGNUP EMAIL_CHANGE }` (`@@map("email_code_purpose")`); `model EmailCode` (`@@map("email_codes")`): `id`, `purpose`, `subject String` (SIGNUP: id da loja; EMAIL_CHANGE: id da pessoa), `email`, `codeHash @map("code_hash")`, `payload Json @default("{}")`, `expiresAt`, `attempts Int @default(0)`, `consumedAt?`, `createdAt`, `updatedAt`, `@@index([purpose, subject, email])`. Saem `VerificationCode` e `VerificationPurpose`.
- Produces (código):
  - `type PersonState = 'pending' | 'active'`; `personState(u: { passwordHash: string | null; googleSub: string | null }): PersonState`.
  - `type GoogleLink = { sub: string; email: string }`.
  - `activatePerson(tx: Prisma.TransactionClient, userId: string, how: { passwordHash: string } | { google: GoogleLink }, now: Date): Promise<boolean>` — UPDATE condicional `WHERE password_hash IS NULL AND google_sub IS NULL`; grava a credencial, `email_verified_at = coalesce(email_verified_at, now)` e chama `consumeInvites`; `false` se a pessoa já estava ativa.
  - `consumeInvites(tx, userId, now): Promise<void>` — todo `UserToken` `INVITE` não usado fica `usedAt = now`.
  - `syncCustomerCopies(tx, userId, data: { name?: string; phone?: string | null; email?: string }): Promise<void>` — atualiza todos os `customers` com `user_id` (nome também regrava `search_name` por `searchKey`).
  - `CustomerView.hasAccount: boolean` (substitui `hasAppAccess`); `Overview.customersWithAccount: number` e `AccountMetrics.customersWithAccount: number` (clientes com `user_id`, não anonimizados).
  - Fábricas: `makeUser({ password?: string | null; google?: GoogleLink; verified?: boolean; phone?: string })` (com senha ou Google: `emailVerifiedAt` preenchido salvo `verified: false`); `makeCustomer(businessId, { userId?, ... })`.

- [ ] **Step 1: Testes que falham.** `tests/integration/migration-pessoa-unica.test.ts` (com `withScratchDb`, migrações até `20261123080000_termos_fixos_e_slugs`, dados inseridos em SQL, depois `applyMigration('20261123090000_pessoa_unica')`):
  - `test('cliente com senha sem pessoa vira pessoa com a mesma senha e a verificação do cliente')` — `users.password_hash` igual ao do cliente; `email_verified_at` igual; `customers.user_id` aponta para ela.
  - `test('e-mail já de pessoa com senha: liga ao cliente e mantém a senha da pessoa')`.
  - `test('e-mail de pessoa pendente: a pessoa recebe a senha e a verificação do cliente')`.
  - `test('mesmo e-mail com senha em duas lojas: uma pessoa e dois clientes ligados')`.
  - `test('equipe com senha fica verificada; convite pendente segue sem verificação')`.
  - `test('cliente de balcão sem senha fica sem pessoa')`.
  - `test('customers perde password_hash e email_verified_at; verification_codes sai')`.
  `tests/integration/schema.test.ts`: `email_codes` existe com `email_codes_live_key`; `customers_business_id_user_id_key` único; `users_google_sub_key` único; CHECK `users_active_verified` recusa pessoa com senha e sem verificação; CHECK `users_google_together` recusa `google_sub` sem `google_email`. `tests/integration/customers.test.ts`: `test('equipe não troca o e-mail de cliente com conta: "O e-mail é da conta do cliente."')` (`validation`, `fields.email`); `test('equipe edita nome, telefone, nascimento, observações e clube do cliente com conta (só na loja)')` (a pessoa não muda); `test('anonimizar desliga a pessoa (user_id e linked_at nulos)')`. `tests/integration/person.test.ts`: `activatePerson` com senha (verifica, consome todos os convites), com Google (grava os três campos), em pessoa ativa devolve `false` e não muda nada; `syncCustomerCopies` atualiza as lojas da pessoa e não toca cliente de outra pessoa.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Migração** (`20261123090000_pessoa_unica`), em `BEGIN; … COMMIT;`, nesta ordem, com comentários em português:
  1. `ALTER TABLE "users" ADD COLUMN "phone" TEXT, ADD COLUMN "email_verified_at" TIMESTAMPTZ(3), ADD COLUMN "google_sub" TEXT, ADD COLUMN "google_email" TEXT, ADD COLUMN "google_linked_at" TIMESTAMPTZ(3);` + `CREATE UNIQUE INDEX "users_google_sub_key"`; `CHECK "users_google_together"`: `("google_sub" IS NULL) = ("google_email" IS NULL) AND ("google_sub" IS NULL) = ("google_linked_at" IS NULL)`.
  2. `UPDATE "users" SET "email_verified_at" = "updated_at" WHERE "password_hash" IS NOT NULL;` (o convite provou o e-mail).
  3. `ALTER TABLE "customers" ADD COLUMN "user_id" UUID, ADD COLUMN "linked_at" TIMESTAMPTZ(3);`
  4. Bloco `DO $$` que percorre `customers WHERE password_hash IS NOT NULL ORDER BY created_at, id`: e-mail nulo → `RAISE EXCEPTION`; acha `users.email = c.email`; sem pessoa → `INSERT` (nome, `search_name`, e-mail, telefone, `password_hash`, `coalesce(c.email_verified_at, now())`); pessoa pendente → `UPDATE` com a senha e a verificação do cliente; pessoa com senha → mantém e `RAISE NOTICE 'Cliente % ligado à pessoa % já existente; a senha do cliente foi descartada.'`; `UPDATE customers SET user_id = <pessoa>, linked_at = now()`. No fim, `RAISE NOTICE` com as contagens (o relatório).
  5. FK `customers_user_id_fkey` → `users(id) ON DELETE SET NULL ON UPDATE NO ACTION`; `CREATE UNIQUE INDEX "customers_business_id_user_id_key" ON "customers"("business_id","user_id")`; índice `customers_user_id_idx`; CHECK `customers_account_has_email`: `"user_id" IS NULL OR "email" IS NOT NULL`; CHECK `customers_linked_together`: `("user_id" IS NULL) = ("linked_at" IS NULL)`; `DROP COLUMN "password_hash", DROP COLUMN "email_verified_at"`.
  6. CHECK `users_active_verified`: `("password_hash" IS NULL AND "google_sub" IS NULL) OR "email_verified_at" IS NOT NULL`.
  7. `sessions.customer_business_id` (FK `businesses ON DELETE SET NULL`) + índice.
  8. `DROP TABLE "verification_codes"; DROP TYPE "verification_purpose";` `CREATE TYPE "email_code_purpose" AS ENUM ('SIGNUP','EMAIL_CHANGE');` `CREATE TABLE "email_codes"` (colunas acima, `attempts` com CHECK `BETWEEN 0 AND 5`), índice `(purpose, subject, email)`, índice `expires_at`, e o parcial `CREATE UNIQUE INDEX "email_codes_live_key" ON "email_codes"("purpose","subject","email") WHERE "consumed_at" IS NULL;`.
- [ ] **Step 4: Código.** `email-code.ts`: mesma mecânica de hoje com `subject` no lugar de `businessId` — `codeMac(subject, purpose, email, code)` (HKDF `agendaflui/verification-code/v1` mantido), `issueEmailCode(i: { purpose; subject; email; payload; now }): Promise<string | null>` (transação própria no Prisma cru, repete uma vez no índice vivo), `confirmEmailCode(tx, i: { purpose; subject; email; code; now })` (mesmo retorno e mesmas regras de UPDATE condicional), `allowCodeRequest(purpose, subject, email, now)` (`codeEmail` + `codeEmailDaily`, chaves `codigo:<purpose>:<subject>` e `codigo-dia:…`), `assertCodeGuessesLeft(subject, email, now)` / `countCodeFailure(subject, email, now)` (`codeFailures`), `purgeEmailCodes(now)`. Telas de Clientes: selo "Tem conta"; campo e-mail só leitura com a dica "O e-mail é da conta do cliente." quando `hasAccount`; origem `APP` aparece como "Pelo link da loja".
- [ ] **Step 5:** `npx prisma generate && npm run typecheck` e os testes do Step 1 → PASS.
- [ ] **Step 6: Commit** `feat: pessoa única no banco (Google, verificação, cliente ligado)`.

### Tarefa 6: Sessão única e "para onde a pessoa vai"

**Files:**
- Move: `src/server/auth/member-auth.ts` → `src/server/auth/session.ts`
- Create: `src/server/auth/destination.ts`, `src/app/app/_lib/SemLoja.tsx`, `tests/unit/destination.test.ts`, `tests/integration/destination.test.ts`, `tests/integration/session.test.ts` (absorve `auth.test.ts`), `tests/integration/entrar-action.test.ts`
- Modify: `src/server/auth/guards.ts`, `src/server/auth/support-session.ts`, `src/server/auth/login-limit.ts` (`LoginArea = 'app' | 'dev'`), `src/server/auth/context.ts`, `src/app/app/page.tsx`, `src/app/app/(entrada)/entrar/{page,actions,PainelEntrada}.tsx` (renomeie para `Entrada.tsx`), `src/app/_lib/login-form.ts` (`SEM_CONTA` sai), `src/app/app/painel/{layout,PainelFrame}.tsx`, `src/app/app/painel/_lib/{SairDaConta,EncerrarSuporte,actions}.tsx`
- Test: `tests/unit/{painel-guards,entrada-unica,login-messages}.test.ts`, `tests/integration/{context,login-race,support-session,dev-account-support-route}.test.ts`

**Interfaces:**
- Produces (`session.ts`):
  - `SESSION_MINUTES = 30 * 24 * 60`.
  - `type PersonSession = { kind: 'person'; sessionId: string; user: { id: string; name: string; email: string }; customerBusinessId: string | null } | { kind: 'support'; admin: { id: string; name: string }; activeBusinessId: string; businessName: string }`.
  - `openSession(tx: Prisma.TransactionClient, i: { userId: string; now: Date; ip?: string; userAgent?: string; previousToken?: string; customerBusinessId?: string | null }): Promise<{ token: string; expiresAt: Date }>` — cria a linha, grava `lastLoginAt`, revoga só a sessão de `previousToken`.
  - `loginWithPassword(i: { email: string; password: string; ip?: string; userAgent?: string; previousToken?: string; customerBusinessId?: string | null }, now: Date): Promise<{ token: string; expiresAt: Date; userId: string }>` — limite `checkLoginLimit('app', …)`, tempo constante, guarda condicional no hash (como hoje); pessoa sem senha → `invalid_credentials`. Não recusa quem não tem loja.
  - `getPersonSession(token: string | undefined, now?: Date): Promise<PersonSession | null>`.
  - `getStaffContext(token: string | undefined, now?: Date): Promise<TenantContext | null>` — suporte como hoje; pessoa: o vínculo `active` numa conta `ACTIVE` (no máximo um, pelo índice), relido a cada chamada.
  - `setSessionStore(token: string, businessId: string): Promise<void>`; `logout(token: string): Promise<void>`.
- Produces (`destination.ts`):
  - `type DestinationFacts = { staff: boolean; stores: { businessId: string; slug: string; linkedAt: Date }[]; lastStoreId: string | null }`.
  - `type Destination = { kind: 'painel' } | { kind: 'store'; slug: string } | { kind: 'no_store' }`.
  - `decideDestination(f: DestinationFacts): Destination` (pura); `destinationPath(d: Destination): string` (`'/painel'`, `` `/${slug}` ``, `'/'`).
  - `loadDestinationFacts(userId: string, lastStoreId: string | null): Promise<DestinationFacts>` — equipe = vínculo ativo em conta ativa; lojas = clientes com `user_id`, sem `archived_at`/`anonymized_at`, conta `ACTIVE`; `linkedAt` = `customers.linked_at`.
  - `destinationFor(session: PersonSession): Promise<Destination>` (suporte → painel).
- Produces (`guards.ts`): `readPersonSession(): Promise<PersonSession | null>`; `requirePerson(): Promise<Extract<PersonSession, { kind: 'person' }>>` (sem sessão → `/entrar`; suporte → `/painel`); `requireTenant(capability?)` (sem sessão → `/entrar`; pessoa sem equipe → `/`; sem capacidade → 404). Saem `requireMemberSession` e `MemberSession`.

- [ ] **Step 1: Testes que falham.** `tests/unit/destination.test.ts` (um teste por caso):
  - `test('equipe ativa vai para /painel mesmo sendo cliente de lojas')`
  - `test('cliente de uma loja vai para /<slug>')`
  - `test('cliente de várias vai para a última usada na sessão')`
  - `test('cliente de várias sem última usada vai para a ligação mais recente')`
  - `test('última usada que não está mais entre as lojas é ignorada')`
  - `test('sem equipe e sem loja: no_store')`
  - `test('destinationPath: /painel, /<slug> e / para no_store')`
  `tests/integration/destination.test.ts`: `test('vínculo inativo ou loja suspensa não conta como equipe')`, `test('cliente arquivado, anonimizado, de balcão ou de loja suspensa não conta')`, `test('sessão de suporte vai para o painel')`. `tests/integration/session.test.ts`: `test('entrar num aparelho não derruba a sessão do outro')`, `test('login revoga só a sessão anterior deste navegador')`, `test('sessão vale 30 dias')`, `test('pessoa sem loja entra (a sessão nasce; o destino é a tela sem loja)')`, `test('conta pendente não entra por senha')`, `test('getStaffContext relê o vínculo: desativado → null')`, `test('suporte entra como hoje e o contexto é da conta da sessão')`. `tests/integration/entrar-action.test.ts` (mock de `request-info`, `next/headers` e `next/navigation` como em `painel-customers-actions.test.ts`): equipe → `redirect('/painel')`; cliente de uma loja → `redirect('/demo')`; ninguém → `redirect('/')`; senha errada → estado com "E-mail ou senha incorretos.".
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar.** `/` (`src/app/app/page.tsx`): sem sessão → `redirect('/entrar')`; com sessão → `destinationFor`; `no_store` renderiza `SemLoja` (`EntryScreen` da marca: título "Sua conta ainda não está em nenhuma loja", mensagem "Entre pelo link que a sua loja enviou.", ações "Minha conta" → `/conta` e "Sair"). `/entrar`: com sessão → redireciona ao destino; título "Entrar", mensagem "Use o e-mail e a senha da sua conta." (ou "Senha nova salva. Entre com ela." com `?senha=nova`), "Esqueci a senha" → `/esqueci-a-senha`; ação → `loginWithPassword` → cookie `APP_COOKIE` → `redirect(destinationPath(...))`. PainelFrame lê `PersonSession` + `ctx` (nome da pessoa; faixa de suporte igual). Sair: `logout` + limpa cookie → `/entrar`.
- [ ] **Step 4:** `npm run typecheck` + testes do Step 1 e os listados → PASS.
- [ ] **Step 5: Commit** `feat: sessão única da pessoa e destino por cadastro`.

### Tarefa 7: Cadastro e entrada pela loja, adoção do balcão

**Files:**
- Create: `src/server/auth/store-join.ts`, `src/server/auth/store-signup.ts`, `src/app/app/[slug]/{page,loading,actions}.tsx`, `src/app/app/[slug]/_lib/{loja.ts,LojaIndisponivel.tsx,UsarMinhaConta.tsx,AbasEntrada.tsx}`, `src/app/app/[slug]/entrar/{page,actions}.tsx`, `src/app/app/[slug]/cadastro/{page,actions,CadastroForm}.tsx`, `src/ui/components/CodeField.tsx` (+ export em `index.ts`), `tests/integration/store-join.test.ts`, `tests/integration/store-signup.test.ts`, `tests/integration/store-entry-actions.test.ts`, `tests/unit/cadastro-form.test.tsx`
- Modify: `src/server/notifications/render-account.ts`, `src/ui/styles/entry.css`, `docs/ARQUITETURA.md` (só a linha da ordem de travas, ver Step 3)
- Test: `tests/unit/render-account.test.ts`

**Interfaces:**
- Consumes: `openSession`, `loginWithPassword` (Tarefa 6); `activatePerson`, `personState` (Tarefa 5); `email-code.ts` (Tarefa 5).
- Produces (`store-join.ts`):
  - `type StoreRef = { businessId: string; slug: string; name: string }`; `findOpenStore(slug: string): Promise<StoreRef | null>` (formato inválido, reservado, inexistente ou não `ACTIVE` → `null`).
  - `type JoinResult = { kind: 'joined' | 'adopted' | 'already'; customerId: string } | { kind: 'blocked' }`.
  - `joinStoreIn(tx, userId: string, businessId: string, now: Date): Promise<JoinResult>` — já ligado e ativo → `already`; ligado e arquivado → `blocked`; balcão com o mesmo e-mail (`user_id` nulo, não anonimizado): arquivado → `blocked`, senão trava `lockKeyRaw(tx, businessId, 'customer', id)` e UPDATE condicional `user_id IS NULL` com `linked_at = now` (preenche telefone vazio, mantém nome, histórico e observações) → `adopted`; senão cria (nome, e-mail e telefone da pessoa, `origin 'APP'`, `linked_at = now`) → `joined`. Violação de `customers_business_id_user_id_key` ou do e-mail por loja: relê e decide de novo uma vez.
  - `joinStore(userId, businessId, now): Promise<JoinResult>` (transação própria; `lockUserAccess` antes).
  - `storeRelation(userId: string | null, businessId: string): Promise<{ isCustomer: boolean; isStaff: boolean; blocked: boolean }>` — só leitura.
- Produces (`store-signup.ts`):
  - `requestStoreSignup(slug: string, input: { name: string; email: string; phone?: string | null; password: string }, meta: RequestMeta, now: Date): Promise<() => Promise<void>>` — síncrono: valida e faz o hash (sempre); loja fechada → `not_found`. Continuação: `allowCodeRequest('SIGNUP', businessId, email)`; pessoa ativa → `renderAccountExists` (link `areaLink('app', '/<slug>/entrar')`); pendente ou inexistente → `issueEmailCode` (`payload { name, phone, passwordHash }`) + `renderSignupCode`.
  - `confirmStoreSignup(slug, input: { email: string; code: string }, meta: RequestMeta, now: Date): Promise<{ token: string; expiresAt: Date; userId: string; join: JoinResult }>` — numa transação: `lockUserAccess` da pessoa se existir; `confirmEmailCode`; inexistente → cria (senha, `emailVerifiedAt = now`, nome, telefone); pendente → `activatePerson({ passwordHash })` + nome digitado + telefone se vazio; ativa → `conflict` "Este e-mail já tem conta. Entre com ela." (`reason: 'email_taken'`); `joinStoreIn`; `openSession({ customerBusinessId })`. Código errado: conta depois do commit e lança `invalid_code` (como hoje).
  - `signInAtStore(slug, input: { email: string; password: string }, meta: RequestMeta, now: Date): Promise<{ token: string; expiresAt: Date; userId: string; join: JoinResult }>` — `loginWithPassword({ customerBusinessId })` + `joinStore`.
- Produces (e-mail): `renderSignupCode(brand: AccountBrand, i: { name: string; code: string; ttlMin: number }): RenderedMail`; `renderAccountExists(brand, i: { name: string; loginUrl: string })` (texto "Este e-mail já tem conta. Entre com ela."); sai `renderPasswordResetCode`.
- Produces (UI): `CodeField` — um campo de 6 dígitos (`inputMode="numeric"`, `autoComplete="one-time-code"`, `pattern="\d{6}"`, `maxLength={6}`, letras espaçadas pelo CSS), props `{ name: string; error?: string | null; autoFocus?: boolean }`.

- [ ] **Step 1: Testes que falham.** `tests/integration/store-join.test.ts`: `test('cliente novo pela loja: cliente criado e ligado com o e-mail da pessoa')`, `test('adota o cliente de balcão com o mesmo e-mail e mantém histórico e observações')`, `test('balcão arquivado ou vínculo arquivado: blocked')`, `test('já cliente: already, sem segundo cadastro')`, `test('abrir a loja com sessão não cria cliente (storeRelation só lê)')`, `test('equipe da loja: isStaff')`, `test('duas entradas simultâneas: um cliente só')`. `tests/integration/store-signup.test.ts` (com `fakeMail` e `setAfterScheduler`):
  - `test('cadastro novo: código por e-mail; pessoa verificada, cliente ligado, sessão na loja')`
  - `test('e-mail de conta ativa: mesma resposta, nenhum código, e-mail "Este e-mail já tem conta. Entre com ela."')`
  - `test('e-mail de conta pendente: o código ativa com a senha escolhida e consome os convites')`
  - `test('código errado conta tentativa; 5 erros matam o código; 10 por dia barram')`
  - `test('duas confirmações simultâneas do mesmo código: uma passa')`
  - `test('dois cadastros do mesmo e-mail em lojas diferentes ao mesmo tempo: uma pessoa só')` (Review Focus 1)
  - `test('loja suspensa, inexistente ou slug reservado: not_found')`
  `tests/integration/store-entry-actions.test.ts`: ações de `/[slug]/entrar` e `/[slug]/cadastro` redirecionam para `/<slug>` com cookie; "Usar minha conta nesta loja" chama `joinStore` e regrava a sessão. `tests/unit/cadastro-form.test.tsx`: depois de enviar os dados, o formulário mostra o passo do código com "Enviamos um código para <e-mail>." e o botão "Reenviar código".
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar.** Ordem de travas (acrescente a linha em `docs/ARQUITETURA.md` > Travas): "Pessoa e loja (cadastro, entrada pela loja, adoção, Google): `lockUserAccess` da pessoa primeiro, depois `customer` da loja." Telas (todas com `EntryScreen` no tema da loja, `getPublicBrandBySlug`):
  - `/[slug]` (provisória): loja fechada → `LojaIndisponivel` (`EntryScreen` da marca Agenda Flui, título "Loja indisponível", mensagem "Esta loja não está disponível agora. Confira o link com a loja."). Aberta: frase grande = nome da loja, título "Em breve a área do cliente"; sem sessão → "Entrar" e "Criar conta"; com sessão e não cliente → `UsarMinhaConta` ("Usar minha conta nesta loja", "A loja vai ver seu nome, e-mail e telefone."); cliente → "Você já é cliente desta loja." + "Minha conta"; `blocked` → "Sua conta nesta loja está desativada. Fale com a loja."; equipe da loja → `LinkButton` "Abrir painel" (`/painel`). `generateMetadata`: `<Loja> | Agenda Flui`.
  - `/[slug]/entrar` e `/[slug]/cadastro`: `AbasEntrada` (`NavTabs`: "Entrar" | "Criar conta"); cadastro em dois passos no mesmo formulário (dados → código), com "Reenviar código", "Trocar e-mail" e erro de campo; com sessão de cliente da loja → `redirect('/<slug>')`.
  - `loading.tsx` com `Skeleton` no formato da tela.
- [ ] **Step 4:** `npm run typecheck` + testes do Step 1 + `tests/unit/render-account.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: cadastro e entrada do cliente pelo link da loja`.

### Tarefa 8: Convite e senha por link para toda pessoa

**Files:**
- Modify: `src/server/auth/invites.ts`, `src/server/auth/password-reset.ts`, `src/server/domain/platform/{access-core,businesses}.ts`, `src/server/domain/team/access.ts`, `src/server/notifications/{render-invite,render-password-reset}.ts`, `src/app/app/(entrada)/convite/[token]/{page,actions,DefinirSenhaForm}.tsx`, `src/app/app/(entrada)/esqueci-a-senha/*`, `src/app/app/(entrada)/redefinir-senha/[token]/*`, `src/app/app/painel/clientes/{Cuidados.tsx,actions.ts}`, `src/app/app/painel/equipe/*` e `src/app/dev/(app)/contas/[id]/TeamPanel.tsx` (`hasAccount`)
- Test: `tests/integration/{invites,password-reset,painel-password-reset-actions,team-access,platform-team,access-locks,painel-customers-actions}.test.ts`, `tests/unit/render-account.test.ts`

**Interfaces:**
- Consumes: `activatePerson`, `consumeInvites`, `personState` (Tarefa 5); `openSession` (Tarefa 6).
- Produces:
  - `issueInvite(tx, userId, now)` — só para pessoa `pending` (senão `conflict`).
  - `readInvite(token, now): Promise<{ userId: string; userName: string; email: string; businessName: string | null } | null>` (`businessName` = conta do vínculo ativo mais recente).
  - `acceptInvite(i: { token: string; password: string }, meta: RequestMeta, now: Date): Promise<{ token: string; expiresAt: Date }>` — consome o token (UPDATE condicional), `activatePerson({ passwordHash })`, revoga sessões antigas e abre sessão nova.
  - `RESET_TTL_MINUTES = 60`; `requestPasswordReset(email, meta, now)`; `readPasswordReset(token, now): Promise<{ email: string } | null>`; `resetPassword(i: { token; password }, meta, now): Promise<void>` (senha + `emailVerifiedAt = coalesce(..., now)` + `consumeInvites` + revoga todas as sessões); `checkResetLimit(ip, token, now)`. Os nomes `*Panel*` saem.
  - `sendCustomerAccountReset(ctx: TenantContext, customerId: string): Promise<void>` — `authorize(ctx, 'manage_clients')`, ator `member` ou `impersonator`; cliente sem conta → `conflict` "Este cliente ainda não tem conta."; envia o link de redefinição à pessoa ligada (limite de `allowResetEmail`).
  - `TeamMember.hasAccount` (substitui `hasPassword`: pessoa ativa).
  - `renderAccessGranted({ businessName, entryLink })` com o texto "Você entrou para a equipe da loja <X>. Entre com a sua conta."; `renderPasswordReset({ name, link, ttlMin })`.

- [ ] **Step 1: Testes que falham.**
  - `password-reset.test.ts`: `test('cliente (sem equipe) recebe o link de redefinição')`, `test('regra 8: pessoa só com Google recebe o link e cria a primeira senha')` (fábrica com `google`), `test('conta pendente: o link define a senha, verifica o e-mail e consome os convites')`, `test('redefinir derruba todas as sessões da pessoa')`, `test('e-mail inexistente: mesma resposta, nada enviado')`.
  - `invites.test.ts`: `test('aceitar convite cria a senha, verifica o e-mail, consome todos os convites e abre sessão')`, `test('convite inválido, vencido ou usado: mesma frase')`.
  - `team-access.test.ts` / `platform-team.test.ts`: `test('convite para e-mail de pessoa ativa (já cliente): vínculo ativo, sem convite, e-mail "Você entrou para a equipe da loja X. Entre com a sua conta."')`; a regra de um vínculo ativo por pessoa continua (`OUTRA_LOJA_MESSAGE`).
  - `painel-customers-actions.test.ts`: `test('equipe envia a redefinição ao cliente com conta; cliente de balcão: "Este cliente ainda não tem conta."')`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar.** Pedido de redefinição: qualquer `User` com o e-mail recebe o link (não reenvia mais convite). Toda checagem "tem senha" de acesso (`access-core.ts` l.322/489/531, `businesses.ts`) passa a `personState(...) === 'active'`. Telas: `/convite/[token]` — `EntryScreen` da marca, título "Ative seu acesso", mensagem "Olá, <nome>. Crie uma senha para entrar em <loja>.", campo "Senha" com a dica "Use 10 caracteres ou mais.", botão "Criar senha e entrar"; depois → `redirect('/painel')`; convite inválido → mesma tela com `INVITE_INVALID_MESSAGE` e "Ir para a entrada". A Tarefa 11 põe o botão do Google aqui. `/esqueci-a-senha` e `/redefinir-senha/[token]` mantêm textos e fluxo (sucesso → `/entrar?senha=nova`). Clientes > Cuidados: volta "Enviar link de redefinição" só para cliente com conta.
- [ ] **Step 4:** `npm run typecheck` + testes listados → PASS.
- [ ] **Step 5: Commit** `feat: convite e redefinição por link para toda pessoa`.

**G2 termina:** `npm run typecheck && npx vitest run <testes tocados em 5–8>`.

---

## G3 — Google

### Tarefa 9: Chaves do Google no painel dev

**Files:**
- Create: `prisma/migrations/20261123100000_chaves_google/migration.sql`, `src/server/domain/platform/google-settings.ts`, `src/server/domain/platform/google-secrets.ts`, `src/app/dev/(app)/sistema/google/{page,GoogleForm,actions,loading}.tsx`, `tests/integration/platform-google-settings.test.ts`, `tests/unit/google-secrets-imports.test.ts`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts` (`PlatformSetting` em `PLATFORM_MODELS`), `eslint.config.mjs`, `src/app/dev/(app)/sistema/page.tsx` (abas `NavTabs`: "Visão geral" | "Google"), `AGENTS.md` (linha de segredos)

**Interfaces:**
- Produces (Prisma) `model PlatformSetting` (`@@map("platform_settings")`): `id Int @id @default(1)`, `googleClientId String? @map("google_client_id")`, `googleClientSecretEnc String? @map("google_client_secret_enc")`, `googleClientSecretLast4 String? @map("google_client_secret_last4") @db.VarChar(4)`, `googleUpdatedAt DateTime? @map("google_updated_at") @db.Timestamptz(3)`, `version Int @default(1)`, `createdAt`, `updatedAt`.
- Produces (código):
  - `GOOGLE_SECRET_AAD = 'platform:google:client_secret'`.
  - `type GoogleSettingsView = { configured: boolean; clientId: string | null; secretLast4: string | null; updatedAt: Date | null; redirectUrl: string; version: number }` (`redirectUrl = areaLink('app', '/google/retorno')`; nunca o segredo).
  - `getGoogleSettings(actor: PlatformAdminActor): Promise<GoogleSettingsView>`; `saveGoogleSettings(actor, input: { clientId: string; clientSecret?: string | null }, version: number, now: Date): Promise<GoogleSettingsView>`; `clearGoogleSettings(actor, version: number, now: Date): Promise<GoogleSettingsView>`; `isGoogleConfigured(): Promise<boolean>` (sem ator; as telas de entrada usam).
  - Leitor restrito `readGoogleClient(): Promise<{ clientId: string; clientSecret: string } | null>` em `google-secrets.ts` — só `src/server/auth/google/**` importa.

- [ ] **Step 1: Testes que falham.** `platform-google-settings.test.ts`: `test('só admin ativo')`; `test('primeira gravação exige a chave secreta')`; `test('grava selado: o banco não guarda o texto e readGoogleClient abre com platform:google:client_secret')`; `test('a visão nunca traz o segredo: traz os 4 últimos, a data e a URL de retorno http://app.localhost:3000/google/retorno')`; `test('trocar só o ID mantém a chave')`; `test('versão velha: stale_version')`; `test('remover: isGoogleConfigured falso e readGoogleClient nulo')`; `test('selo adulterado: readGoogleClient nulo e log só com o nome do erro')`; `test('auditoria guarda só os nomes dos campos')`. `google-secrets-imports.test.ts`: o mesmo desenho de `integration-secrets-imports.test.ts` com `ARQUIVO = 'src/server/domain/platform/google-secrets.ts'` e `PASTAS_LIBERADAS = ['src/server/auth/google/']`; nada em `src/app/`, `src/ui/`; sem reexportação.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Migração:**

```sql
-- Configurações da plataforma (uma linha só): por enquanto, as chaves do "Entrar com Google".
-- O segredo fica selado (secret-box, AAD platform:google:client_secret); a tela mostra só os 4 últimos.
BEGIN;
CREATE TABLE "platform_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "google_client_id" TEXT,
  "google_client_secret_enc" TEXT,
  "google_client_secret_last4" VARCHAR(4),
  "google_updated_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_settings_single_row" CHECK ("id" = 1),
  CONSTRAINT "platform_settings_google_together" CHECK (
    ("google_client_id" IS NULL) = ("google_client_secret_enc" IS NULL)
    AND ("google_client_secret_enc" IS NULL) = ("google_client_secret_last4" IS NULL))
);
INSERT INTO "platform_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);
COMMIT;
```
- [ ] **Step 4: Código.** Validação: ID `^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$` ("Cole o ID do cliente do Google (termina em .apps.googleusercontent.com)."); chave 10–200 caracteres sem espaço ("Cole a chave secreta do cliente do Google."). Gravação com versão (como `integrations.ts`), `auditPlatform(tx, actor, { businessId: null, action: 'platform.google_updated' | 'platform.google_cleared', targetType: 'platform_settings', targetId: '1', metadata: { fields } })`. ESLint: novo padrão `semSegredosGoogle` (`['**/google-secrets', '**/google-secrets.*']`) em todos os blocos de `no-restricted-imports`, e um bloco depois do de `src/server/auth/**` para `src/server/auth/google/**` sem ele. Tela (`DevFrame`, título "Google"): cartão "Entrar com Google" com `StatusDot` "Ligado"/"Desligado", "URL de retorno" com `CopyButton` e a dica "Cole no console do Google em URIs de redirecionamento autorizados.", "ID do cliente", "Chave secreta" (`type="password"`, dica "Deixe em branco para manter a atual (termina em <last4>)."), "Salva em <data>", botões "Salvar" e "Remover chaves" (`ConfirmForm`). `AGENTS.md`: acrescente à regra de segredos "e as chaves do Google só por `domain/platform/google-secrets.ts` (só `auth/google/**` importa; `tests/unit/google-secrets-imports.test.ts` confere)".
- [ ] **Step 5:** `npx prisma generate && npm run typecheck && npx eslint src/server src/app/dev` + testes do Step 1 → PASS.
- [ ] **Step 6: Commit** `feat: chaves do Google no painel dev`.

### Tarefa 10: OIDC do Google (gateway, cookie de fluxo, `id_token`)

**Files:**
- Create: `src/server/integrations/google.ts`, `src/server/auth/google/flow.ts`, `src/server/auth/google/id-token.ts`, `src/server/auth/google/config.ts`, `src/app/app/google/falso/{page,actions}.tsx`, `tests/unit/google-flow.test.ts`, `tests/unit/google-id-token.test.ts`
- Modify: `src/server/integrations/{index,fakes}.ts`

**Interfaces:**
- Produces (`integrations/index.ts`):
  - `type GoogleIdClaims = { iss: string; aud: string; sub: string; exp: number; iat: number; email?: string; email_verified?: boolean; nonce?: string; name?: string }`.
  - `interface GoogleGateway { authorizationEndpoint(): string; exchangeCode(i: { clientId: string; clientSecret: string; code: string; codeVerifier: string; redirectUri: string }): Promise<{ idToken: string }>; keys(): JWTVerifyGetKey }` (tipo do `jose`); falha HTTP é `IntegrationError`.
  - `Integrations` ganha `google: GoogleGateway`. Real (`google.ts`): `https://accounts.google.com/o/oauth2/v2/auth`, POST `https://oauth2.googleapis.com/token` (form, pelo `http.ts`, com tempo limite), `createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))` criado uma vez.
  - Falso (`fakes.ts`): `fakeGoogleAuthority(): FakeGoogle` (o mesmo objeto que `integrations().google` usa em modo `fake`), com `FakeGoogle = GoogleGateway & { issueCode(claims: Partial<GoogleIdClaims> & { sub: string; email: string }): Promise<string>; sign(claims: Partial<GoogleIdClaims>): Promise<string>; reset(): void }` — chave RS256 gerada uma vez (`generateKeyPair`), `keys()` por `createLocalJWKSet`, `authorizationEndpoint()` = `areaLink('app', '/google/falso')`, `exchangeCode` devolve o token guardado para o código (uso único; código desconhecido → `IntegrationError`). Padrões de `issueCode`: `iss 'https://accounts.google.com'`, `exp` = agora + 1 h.
- Produces (`flow.ts`):
  - `GOOGLE_FLOW_COOKIE = 'af_google'`; `FLOW_TTL_SEC = 600`.
  - `type GoogleIntent = { kind: 'sign_in' } | { kind: 'store_signup'; slug: string } | { kind: 'invite'; token: string } | { kind: 'link' }` — a fase 4 acrescenta `{ kind: 'calendar' }` (escopo `https://www.googleapis.com/auth/calendar.events`, `access_type=offline`, `include_granted_scopes=true`); o esquema zod é `z.discriminatedUnion('kind', …)`, então intenção desconhecida não passa.
  - `type GoogleFlow = { v: 1; state: string; nonce: string; verifier: string; intent: GoogleIntent }`.
  - `startGoogleFlow(intent: GoogleIntent, now: Date): Promise<{ url: string; cookie: string } | null>` (`null` = sem chaves).
  - `readGoogleFlow(cookie: string | undefined, now: Date): Promise<GoogleFlow | null>`.
  - `googleRedirectUri(): string` = `areaLink('app', '/google/retorno')`.
- Produces (`config.ts`): `googleClient(): Promise<{ clientId: string; clientSecret: string } | null>` (único importador de `google-secrets.ts`).
- Produces (`id-token.ts`): `type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name: string | null }`; `class GoogleTokenError extends Error`; `verifyGoogleIdToken(idToken: string, i: { clientId: string; nonce: string; now: Date; keys: JWTVerifyGetKey }): Promise<GoogleIdentity>`.

- [ ] **Step 1: Testes que falham.** `google-id-token.test.ts` (chaves de `fakeGoogleAuthority()`): `test('válido devolve sub e e-mail em minúsculas')`, `test('assinado por outra chave: recusa')`, `test('aud de outro cliente: recusa')`, `test('iss que não é do Google: recusa')`, `test('vencido: recusa')`, `test('nonce de outro fluxo: recusa')`, `test('sem e-mail: recusa')`, `test('email_verified falso volta emailVerified false (a decisão recusa)')`. `google-flow.test.ts`: `test('URL com response_type=code, client_id, redirect_uri, scope "openid email profile", state, nonce, code_challenge S256 do verifier e prompt=select_account')`; `test('a intenção viaja no cookie e nunca na URL')` (URL sem o token do convite nem o slug); `test('cookie adulterado, vencido, de versão ou intenção desconhecida: null')`; `test('sem chaves: null')`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar.** Cookie = JWT HS256 (`SignJWT`), chave HKDF-SHA256(`APP_SECRET`, '', `agendaflui/google-flow/v1`, 32), `exp` = agora + 600 s; `state`, `nonce` e `verifier` com 32 bytes aleatórios em base64url; desafio = base64url(SHA-256(verifier)). `jwtVerify` com `issuer: ['https://accounts.google.com', 'accounts.google.com']`, `audience: clientId`, `algorithms: ['RS256']`, `currentDate: now`, `clockTolerance: 60`; `nonce` comparado em tempo constante; e-mail normalizado por `normalizeEmail`. `/google/falso` (só com `env.INTEGRATIONS_MODE === 'fake'`, senão `notFound()`): `EntryScreen` "Simular Google" com "E-mail", "Nome", "E-mail confirmado pelo Google" (marcado), "Identificador" (padrão `falso-<e-mail>`), "Continuar" e "Cancelar"; a ação lê o `nonce` do cookie de fluxo, chama `issueCode` e vai para `/google/retorno?code=…&state=…` (cancelar → `?error=access_denied&state=…`).
- [ ] **Step 4:** `npm run typecheck` + testes do Step 1 → PASS.
- [ ] **Step 5: Commit** `feat: OIDC do Google com PKCE, state e nonce`.

### Tarefa 11: Regras do Google, retorno e botões

**Files:**
- Create: `src/server/auth/google/decide.ts`, `src/server/auth/google/callback.ts`, `src/app/app/google/entrar/route.ts`, `src/app/app/google/retorno/route.ts`, `src/app/app/google/mensagens.ts`, `src/ui/components/GoogleButton.tsx` (+ export), `tests/unit/google-decide.test.ts`, `tests/integration/google-callback.test.ts`, `tests/integration/google-routes.test.ts`, `tests/unit/google-button.test.tsx`
- Modify: `src/server/auth/rate-limit-db.ts` (se precisar de regra nova), telas `src/app/app/(entrada)/entrar`, `src/app/app/[slug]/entrar`, `src/app/app/[slug]/cadastro`, `src/app/app/(entrada)/convite/[token]` (botão + mensagem `?google=`), `src/ui/styles/entry.css` (divisor "ou")

**Interfaces:**
- Consumes: Tarefas 5–10 (`activatePerson`, `openSession`, `destinationFor`, `findOpenStore`, `joinStoreIn`, `readInvite`, `lockUserAccess`, `startGoogleFlow`, `readGoogleFlow`, `verifyGoogleIdToken`, `googleClient`, `isGoogleConfigured`).
- Produces (`decide.ts`, pura):
  - `type PersonFact = { id: string; email: string; state: PersonState; googleSub: string | null }`.
  - `type GoogleFacts = { identity: GoogleIdentity; bySub: PersonFact | null; byEmail: PersonFact | null; invite: { userId: string; email: string } | null; store: StoreRef | null; current: PersonFact | null }`.
  - `type GoogleRefusal = 'email_not_verified' | 'account_exists' | 'unknown_google' | 'google_taken' | 'email_mismatch' | 'invite_invalid' | 'store_unavailable' | 'already_linked' | 'not_signed_in'`.
  - `type GoogleDecision = { kind: 'sign_in'; userId: string } | { kind: 'activate'; userId: string } | { kind: 'create' } | { kind: 'link'; userId: string } | { kind: 'refuse'; reason: GoogleRefusal }`.
  - `decideGoogle(intent: GoogleIntent, f: GoogleFacts): GoogleDecision`, nesta ordem:
    - sempre primeiro: `!identity.emailVerified` → `email_not_verified` (regra 10);
    - `sign_in`: `bySub` → `sign_in` (1); `byEmail` ativa → `account_exists` (2); pendente → `activate` (2b); senão `unknown_google` (5);
    - `store_signup`: `store` nulo → `store_unavailable`; `bySub` → `sign_in` (1); `byEmail` ativa → `account_exists` (2); pendente → `activate` (2b); senão `create` (4);
    - `invite`: `invite` nulo → `invite_invalid`; `bySub` → `google_taken` (3); e-mail ≠ `invite.email` → `email_mismatch` (3); senão `activate(invite.userId)` (3);
    - `link`: `current` nulo → `not_signed_in`; `current.googleSub` → `already_linked`; `bySub` de outra pessoa → `google_taken` (6); e-mail ≠ `current.email` → `email_mismatch` (6); senão `link` (6).
- Produces (`callback.ts`):
  - `type GoogleFailure = GoogleRefusal | 'not_configured' | 'flow_invalid' | 'canceled' | 'provider_error' | 'rate_limited'`.
  - `type GoogleOutcome = { ok: true; session: { token: string; expiresAt: Date } | null; redirectTo: string } | { ok: false; failure: GoogleFailure; redirectTo: string }`.
  - `handleGoogleCallback(i: { code: string | null; state: string | null; error: string | null; flowCookie: string | undefined; sessionToken: string | undefined; ip?: string; userAgent?: string; now: Date }): Promise<GoogleOutcome>`.
  - `failureTarget(intent: GoogleIntent | null, failure: GoogleFailure): string` — `sign_in`/nulo → `/entrar?google=<f>`; `store_signup` → `/<slug>/entrar?google=<f>`; `invite` → `/convite/<token>?google=<f>`; `link` → `/conta?google=<f>`.
  - `beginGoogle(intent: GoogleIntent, ip: string | undefined, now: Date): Promise<{ url: string; cookie: string } | { failure: 'not_configured' | 'rate_limited' }>`.
- Produces (rotas): `POST /google/entrar` (form: `fluxo` ∈ `entrar|loja|convite|vincular`, `slug`, `convite`; confere `mesmaOrigem`, senão 403; grava `af_google` `HttpOnly; SameSite=Lax; Path=/google; Max-Age=600` (+ `Secure` em produção); 303 para o Google ou para `failureTarget`); `GET /google/retorno` (chama `handleGoogleCallback`, grava `af_session` quando há sessão, apaga `af_google`, 303 para `redirectTo`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`).
- Produces (UI): `GoogleButton({ enabled: boolean; fluxo: 'entrar' | 'loja' | 'convite' | 'vincular'; slug?: string; convite?: string; label?: string })` — `enabled=false` → `null` (regra 11); formulário POST para `/google/entrar`; logotipo "G" em SVG nas cores do Google; rótulo padrão "Continuar com Google"; `loading` por `useFormStatus`. `GOOGLE_MESSAGES: Record<GoogleFailure | 'vinculado', string>` em `mensagens.ts`:
  - `account_exists`: "Este e-mail já tem conta no Agenda Flui. Entre com a sua senha e vincule o Google em Minha conta."
  - `unknown_google`: "Não achamos uma conta com este Google. Se você é cliente, entre pelo link que a sua loja enviou."
  - `google_taken`: "Este Google já está ligado a outra conta."
  - `email_not_verified`: "Esta conta Google não tem o e-mail confirmado. Use outra conta ou entre com e-mail e senha."
  - `email_mismatch`: "Use a conta Google com o mesmo e-mail do convite ou da sua conta."
  - `invite_invalid`: `INVITE_INVALID_MESSAGE`; `store_unavailable`: "Esta loja não está disponível agora."; `already_linked`: "Sua conta já tem um Google. Desvincule antes de trocar."; `not_signed_in`: "Entre na sua conta para vincular o Google."; `not_configured`: "Entrar com Google não está disponível agora."; `flow_invalid`: "O tempo para entrar com o Google acabou. Tente de novo."; `canceled`: "Entrada com Google cancelada."; `provider_error`: "O Google não respondeu. Tente de novo em instantes."; `rate_limited`: "Muitas tentativas. Tente de novo em alguns minutos."; `vinculado`: "Google vinculado."

- [ ] **Step 1: Testes que falham.** `tests/unit/google-decide.test.ts`:
  - `test('regra 10: e-mail não verificado é recusado em todas as intenções, mesmo com Google vinculado')`
  - `test('regra 1: Google vinculado entra na dona do vínculo (entrar e cadastro na loja)')`
  - `test('regra 1: Google vinculado cujo e-mail agora é de outra pessoa entra na dona do vínculo')`
  - `test('regra 2: Google novo com e-mail de conta ativa não entra (entrar e cadastro na loja)')`
  - `test('regra 2b: Google novo com e-mail de conta pendente ativa a conta')`
  - `test('regra 3: convite aceita o Google do mesmo e-mail')` / `test('regra 3: convite recusa outro e-mail')` / `test('regra 3: convite recusa Google ligado a outra pessoa')` / `test('regra 3: convite inválido')`
  - `test('regra 4: cliente novo pela loja cria a pessoa')` / `test('regra 4: loja indisponível recusa')`
  - `test('regra 5: Google desconhecido na entrada geral não cria conta')`
  - `test('regra 6: vincular aceita o Google do mesmo e-mail')` / `test('regra 6: vincular recusa outro e-mail, Google de outra pessoa, quem já tem Google e quem não está entrado')`
  `tests/integration/google-callback.test.ts` (chaves salvas pela Tarefa 9, `fakeGoogleAuthority()`, fluxo começado por `beginGoogle`, `nonce` lido por `readGoogleFlow`):
  - `test('regra 1: entra, atualiza google_email e não muda a pessoa')`
  - `test('regra 2: recusa com account_exists e não cria pessoa')`
  - `test('regra 2b: vincula a conta pendente, verifica, consome os convites e abre sessão')`
  - `test('regra 3: convite aceito pelo Google: vínculo feito, convite consumido, destino /painel')`
  - `test('regra 4: cria pessoa verificada e vinculada e o cliente da loja; adota o balcão com o mesmo e-mail')`
  - `test('regra 5: nada criado; destino /entrar?google=unknown_google')`
  - `test('regra 6: vincula na pessoa da sessão; destino /conta?google=vinculado; sem sessão nova')`
  - `test('regra 10: e-mail não verificado não cria, não vincula e não entra')`
  - `test('regra 11: sem chaves, beginGoogle devolve not_configured')`
  - `test('invariante: dois retornos simultâneos do mesmo Google novo criam uma pessoa só')`
  - `test('invariante: no vínculo o e-mail verificado do Google é igual ao da pessoa')`
  - `test('state diferente, cookie vencido ou ausente: flow_invalid; o mesmo código não serve duas vezes')`
  - `test('id_token com nonce de outro fluxo: flow_invalid')`
  - `test('error=access_denied: canceled')`
  - `test('21ª tentativa do mesmo IP em 15 minutos: rate_limited')`
  `tests/integration/google-routes.test.ts`: POST sem `Origin` do host → 403; POST com `fluxo=convite` → `set-cookie` `af_google` com `HttpOnly`, `SameSite=Lax`, `Path=/google`, `Max-Age=600` e 303 para o endpoint de autorização; GET `/google/retorno` de sucesso grava `af_session`, apaga `af_google` e responde 303. `tests/unit/google-button.test.tsx`: `enabled=false` não renderiza nada; o formulário posta para `/google/entrar` com `fluxo`, `slug` e `convite`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar.** Aplicação da decisão numa transação do Prisma cru: trava a pessoa envolvida (`lockUserAccess`), **relê os fatos e decide de novo** sob a trava; `sign_in` → `google_email` = e-mail do Google + `openSession`; `activate` → `activatePerson({ google })` + `openSession`; `create` → `INSERT` da pessoa (nome do Google ou a parte antes do `@`, e-mail, `emailVerifiedAt = now`, Google) + `openSession`; `link` → UPDATE condicional `google_sub IS NULL` (sem sessão nova); `store_signup` com sessão → `joinStoreIn` e `customerBusinessId`. Violação de `users_email_key`/`users_google_sub_key`: relê e decide de novo uma vez. Limites: `beginGoogle` por IP (`google-inicio:ip`, `authIp`); retorno por IP (`google:ip`, `loginIp`) antes de trocar o código, e por `sub` (`google:sub`, `loginEmailWide`) depois de conferir o token. Sucesso: `sign_in`/`activate`/`create` → `destinationPath(destinationFor(...))`, exceto `store_signup` → `/<slug>`. Telas: botão em `/entrar`, `/[slug]/entrar`, `/[slug]/cadastro` (destaque, acima do formulário, com divisor "ou") e `/convite/[token]` (abaixo de "Criar senha"), todos com `enabled={await isGoogleConfigured()}`; `?google=<código>` mostra a mensagem em `role="alert"` (ou de sucesso para `vinculado`).
- [ ] **Step 4:** `npm run typecheck` + testes do Step 1 → PASS.
- [ ] **Step 5: Commit** `feat: entrar e vincular com Google, regras 1 a 11`.

**G3 termina:** `npm run typecheck && npx vitest run <testes tocados em 9–11>` e `npx eslint src/server src/app`.

---

## G4 — Minha conta

### Tarefa 12: Domínio de Minha conta

**Files:**
- Create: `src/server/auth/person-account.ts`, `src/shared/person.ts`, `tests/integration/person-account.test.ts`, `tests/unit/person-shared.test.ts`
- Modify: `src/server/notifications/render-account.ts` (`renderEmailChangeCode`)
- Delete: `src/server/domain/account/profile.ts`, `tests/integration/account-profile.test.ts` (os casos de senha migram para o teste novo)

**Interfaces:**
- Consumes: `lockUserAccess`, `revokeUserAccess` (`password-reset.ts`); `syncCustomerCopies`, `personState` (Tarefa 5); `email-code.ts`; `setSessionStore` (Tarefa 6); `isGoogleConfigured` (Tarefa 9).
- Produces:
  - `type PersonAccountView = { name: string; email: string; phone: string | null; phoneLabel: string | null; hasPassword: boolean; google: { email: string; linkedAt: Date } | null; googleAvailable: boolean; stores: { businessId: string; slug: string; name: string; current: boolean }[]; staff: { businessName: string; roleLabel: string; canWatchAll: boolean; watchAll: boolean } | null }`.
  - `getPersonAccount(userId: string, customerBusinessId: string | null): Promise<PersonAccountView>`.
  - `updatePersonProfile(userId: string, input: { name: string; phone?: string | null }): Promise<void>` — pessoa e todas as cópias numa transação (`lockUserAccess`).
  - `setPersonPassword(userId: string, input: { current?: string; next: string }, keepSessionToken: string, now: Date): Promise<void>` — com senha: exige a atual (5 tentativas/15 min, chave `senha-pessoa:<id>`; nova ≠ atual); sem senha (só Google): cria sem a atual; em ambos derruba as outras sessões e apaga tokens de redefinição vivos.
  - `requestEmailChange(userId: string, input: { email: string }, now: Date): Promise<() => Promise<void>>` — síncrono: e-mail igual → `validation` "Este já é o seu e-mail."; sem senha, com Google e e-mail ≠ e-mail do Google → `conflict` "Crie uma senha antes de trocar o e-mail." (`reason: 'needs_password'`). Continuação: `allowCodeRequest('EMAIL_CHANGE', userId, email)`, `issueEmailCode`, `renderEmailChangeCode` para o e-mail **novo**.
  - `confirmEmailChange(userId: string, input: { email: string; code: string }, now: Date): Promise<{ googleUnlinked: boolean }>` — sob `lockUserAccess`: confere o código; repete a checagem `needs_password`; e-mail de outra pessoa → `conflict` "Este e-mail já tem conta no Agenda Flui." (`email_taken`); cliente de balcão com o e-mail numa loja onde a pessoa é cliente → `conflict` "Este e-mail já está no cadastro de outro cliente numa loja sua. Fale com a loja." (`customer_email_taken`); grava e-mail + `emailVerifiedAt = now` + `syncCustomerCopies({ email })`; Google com e-mail diferente → limpa os três campos do Google (`googleUnlinked: true`; a fase 4 desliga a agenda aqui).
  - `unlinkGoogle(userId: string, now: Date): Promise<void>` — sem Google → `not_found` "Nenhum Google vinculado."; sem senha → `conflict` "Crie uma senha antes de desvincular, para não perder o acesso." (`needs_password`); senão limpa (UPDATE condicional).
  - `switchStore(sessionToken: string, userId: string, businessId: string): Promise<{ slug: string }>` — só loja em que é cliente (senão `not_found`).
  - `emailChangeUnlinksGoogle(google: { email: string } | null, newEmail: string): boolean` em `src/shared/person.ts`.

- [ ] **Step 1: Testes que falham.** `person-account.test.ts`:
  - `test('nome e telefone mudam na pessoa e em todas as lojas em que ela é cliente')`
  - `test('só Google cria a primeira senha sem a atual')`
  - `test('trocar senha exige a atual, derruba as outras sessões e mantém a atual')`
  - `test('regra 7: desvincular sem senha é recusado com "Crie uma senha antes de desvincular, para não perder o acesso."')`
  - `test('regra 7: desvincular com senha limpa sub, e-mail e data do Google')`
  - `test('regra 9: trocar o e-mail com Google de outro e-mail desvincula o Google')`
  - `test('regra 9: trocar para o e-mail do próprio Google mantém o vínculo')`
  - `test('regra 9: só Google tentando outro e-mail: needs_password e nada muda')`
  - `test('troca de e-mail atualiza a cópia em todas as lojas na mesma transação')`
  - `test('e-mail de outra pessoa: email_taken e nada muda')` / `test('e-mail de cliente de balcão numa loja da pessoa: customer_email_taken e nada muda')` (Review Focus 3)
  - `test('o código vai para o e-mail novo; código errado conta tentativa')`
  - `test('trocar de loja só para loja em que é cliente')`
  - `test('invariante: nenhuma ação de Minha conta deixa a pessoa sem senha e sem Google')` (percorre desvincular, trocar e-mail e criar senha em pessoa só-Google; confere `personState === 'active'` depois de cada uma). (Review Focus 4)
  `person-shared.test.ts`: `emailChangeUnlinksGoogle(null, 'a@x') === false`; `({ email: 'a@x' }, 'A@X ') === false`; `({ email: 'a@x' }, 'b@x') === true`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** Implementar conforme as interfaces (Prisma cru só em `src/server/auth/`; nome por `personNameSchema`, telefone por `normalizePhone`, e-mail por `normalizeEmail` + `isSafeRecipient`).
- [ ] **Step 4:** `npm run typecheck` + testes do Step 1 → PASS.
- [ ] **Step 5: Commit** `feat: domínio de Minha conta`.

### Tarefa 13: Tela Minha conta

**Files:**
- Create: `src/app/app/conta/{page,loading,actions}.tsx`, `src/app/app/conta/_partes/{DadosForm,EmailForm,SenhaForm,GoogleSecao,AvisosSecao,LojasSecao}.tsx`, `src/ui/shells/AccountShell.tsx` (+ export), `src/ui/styles/conta.css` (+ `@import` em `src/ui/ui.css`), `tests/integration/conta-actions.test.ts`, `tests/unit/conta-email-form.test.tsx`
- Modify: `src/ui/shells/painel-nav.ts` ("Meu perfil" → `/conta`), `src/app/app/painel/configuracoes/{page,Formularios,actions}.tsx` (seção "Meu perfil" vira cartão com `LinkButton` "Abrir Minha conta"; `PerfilForm`/`SenhaForm` e suas ações saem), `src/app/app/painel/PainelFrame.tsx` (menu da conta ganha "Minha conta"), `tests/unit/painel-links.test.ts` (já aceita `/conta`)

**Interfaces:**
- Consumes: Tarefa 12 inteira; `GoogleButton` (Tarefa 11) com `fluxo='vincular'`; `GOOGLE_MESSAGES`; `setNotifyAllAppointments(ctx, value)` com `getStaffContext`; `requirePerson`.
- Produces: `AccountShell({ title: string; back: { href: string; label: string } | null; children })` — barra do topo com a marca Agenda Flui, link de volta, coluna central (máx. 40 rem), `PageTransition`. Ações (`'use server'`, `FormState` de `src/app/_lib/form-state.ts`): `salvarDados`, `pedirCodigoDeEmail`, `confirmarEmail`, `salvarSenha`, `desvincularGoogle`, `trocarLoja` (→ `redirect('/<slug>')`), `salvarAvisosDaLoja`, `sair` (→ `/entrar`).

- [ ] **Step 1: Testes que falham.** `conta-actions.test.ts`: cada ação chama o domínio com o `userId` da sessão (nunca do formulário); erros viram `fields` (`needs_password` em `desvincularGoogle` devolve a mensagem da regra 7); `trocarLoja` de loja alheia → mensagem "Escolha uma das suas lojas."; sessão de suporte → `redirect('/painel')`; `salvarAvisosDaLoja` de profissional → `forbidden`. `conta-email-form.test.tsx`: `test('mostra "O Google vinculado usa outro e-mail e será desvinculado." quando o e-mail novo difere do Google')`, `test('não mostra quando é o mesmo e-mail do Google')`, `test('passo do código aparece depois de "Enviar código"')`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar a tela** (`AccountShell` com título "Minha conta"; voltar: equipe → "Voltar ao painel" `/painel`, cliente → "Voltar à loja" `/<slug atual>`), cartões `Card` em ordem:
  - "Seus dados": "Nome", "Telefone" (`MaskedInput`), botão "Salvar dados"; para cliente, a dica "Vale para todas as suas lojas."
  - "E-mail": e-mail atual; "Trocar e-mail" abre o passo 1 ("Novo e-mail", "Enviar código") e o passo 2 (`CodeField`, "Confirmar"), com "Reenviar código"; aviso de desvínculo (regra 9) antes de confirmar; com `needs_password`, "Crie uma senha antes de trocar o e-mail." + `LinkButton` "Criar senha" (`#senha`).
  - "Senha" (`id="senha"`): "Criar senha" (só "Senha nova") ou "Trocar senha" ("Senha atual", "Senha nova").
  - "Google" (se `googleAvailable` ou já vinculado): vinculado → "Vinculado a <e-mail do Google>" + "Desvincular" (`ConfirmForm`; sem senha, a frase da regra 7 e "Criar senha"); não vinculado → `GoogleButton fluxo="vincular" label="Vincular conta Google"`. `?google=` mostra a mensagem.
  - "Avisos da loja" (só dono e gerente): `Switch` "Receber por e-mail os avisos de todos os agendamentos da loja".
  - "Suas lojas" (só cliente de duas ou mais): lista com a atual marcada e "Ir para a loja".
  - Rodapé: botão "Sair".
  Estados: `loading.tsx` com esqueleto dos cartões; cada formulário com `loading` no botão, erro de campo e mensagem de sucesso curta ("Dados salvos.", "Senha salva.", "E-mail trocado."); funciona a 360 px (cartões em coluna, botões de largura total abaixo de 30 rem).
- [ ] **Step 4:** `npm run typecheck` + testes do Step 1 + `tests/unit/painel-nav.test.ts tests/integration/painel-settings-actions.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: tela Minha conta`.

**G4 termina:** `npm run typecheck && npx vitest run <testes tocados em 12–13>`.

---

## G5 — Docs, demo e verificação

### Tarefa 14: Documentação, scripts, varreduras finais e verificação completa

**Files:**
- Modify: `docs/ARQUITETURA.md`, `docs/PUBLICACAO.md`, `README.md`, `AGENTS.md` (seção Hosts), `.env.example`, `Dockerfile` (build: `DEV_HOST="dev.build.test" APP_HOST="app.build.test"`), `scripts/dev.ts` (imprime "Painel dev" e "Agenda Flui (app)"), `scripts/demo-create.ts` (link de entrada `areaLink('app','/entrar')` e de clientes `customerLinkUrl`), `scripts/smoke-pages.ts`, `package.json` (sai `test:e2e`), `docs/superpowers/pendencias-proximas-fases.md`
- Delete: `tests/e2e/**`, `playwright.config.ts`
- Create: `tests/unit/sem-api-do-app.test.ts`

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Teste que falha.** `sem-api-do-app.test.ts`: `arquivosCom(/API do (app|aplicativo)|Requisições à API|Usuários do app|api\.agendaflui|PAINEL_HOST|API_HOST|APP_WEB_URL|APP_WEB_ORIGINS|EXPO_ACCESS_TOKEN/, ['src', 'scripts', 'prisma', 'docs/ARQUITETURA.md', 'docs/PUBLICACAO.md', 'README.md', 'AGENTS.md', '.env.example', 'Dockerfile'], ['src/server/db/generated'])` vazio.
- [ ] **Step 2:** rodar → FAIL nas docs.
- [ ] **Step 3: Docs enxutas, sem histórico.**
  - `AGENTS.md` > Hosts: "Dois hosts, vindos de variáveis de ambiente (nunca fixos no código): `DEV_HOST` (painel da plataforma, usado por nós, os admins) e `APP_HOST` (o Agenda Flui de donos, equipes e clientes: entrada, `/painel/**`, `/<slug>/**` e Minha conta). `LEGACY_PAINEL_HOST`, opcional, só redireciona (308) o endereço antigo do painel."
  - `ARQUITETURA.md`: seção de hosts com a tabela das rotas da spec, a regra do `routeRequest` (pastas-raiz `dev/` e `app/` não são acessíveis direto) e o legado; camadas sem `src/server/api`; pessoa e sessão (cookie `af_session`, 30 dias, destino em `auth/destination.ts`); chaves do Google e o leitor restrito; ordem de travas com a linha de pessoa e loja; fila só por e-mail; tarefas do agendador sem `usage_flush`; webhook em `POST /webhooks/mercadopago/{chave}`.
  - `PUBLICACAO.md`: domínios no Coolify (`app.` serve tudo; `painel.` só com `LEGACY_PAINEL_HOST`; `api.` sai), variáveis novas, URL do webhook no Mercado Pago, passo a passo do Google (criar cliente OAuth "Aplicativo da Web", URI de redirecionamento `https://<APP_HOST>/google/retorno`, tela de consentimento com `email`/`profile`/`openid`, colar ID e chave em Sistema → Google; aviso de app não verificado só para a agenda, na fase 4).
  - `README.md` e `.env.example`: `APP_HOST`, `LEGACY_PAINEL_HOST`; somem as variáveis antigas e o Expo.
  - `pendencias-proximas-fases.md`: sai "Quando o app chegar" e a linha do e2e; entra a lista do que o dono confere no navegador nesta fase (entrar, cadastro com código pela loja, convite com senha e com Google, Minha conta inteira, `/google/falso`, redirecionamento do `painel.`, Sistema → Google).
- [ ] **Step 4: Fumaça.** `scripts/smoke-pages.ts` ganha, no host do app: `/entrar`, `/esqueci-a-senha`, `/redefinir-senha/x`, `/convite/x`, `/demo`, `/demo/entrar`, `/demo/cadastro`, `/nao-existe` (Loja indisponível), `/conta` (com a sessão do dono) e, no dev, `/sistema/google`. Rode `npm run smoke` com o banco local de pé (`npm run db:start`); se não estiver, registre.
- [ ] **Step 5: Verificação completa.** `npm run typecheck && npm run lint && npm test && npm run build` → tudo verde, sem aviso novo. `npm run demo:create` num banco limpo (`npm run db:reset`) termina e imprime os links do `APP_HOST`.
- [ ] **Step 6: Commit** `docs: endereço único, pessoa única e Google na documentação`.

**G5 termina** com a verificação completa do Step 5; depois, a revisão final única (Opus) sobre o ramo inteiro, guiada pela Review Focus.
