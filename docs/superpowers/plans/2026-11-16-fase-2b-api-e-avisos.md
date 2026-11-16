# AgendaFlui — Fase 2B: API `v1` e envio de avisos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor o domínio de agenda ao aplicativo por uma API `v1` versionada e documentada (chaves de app, login de cliente e de equipe por token, rotas públicas, do cliente e da equipe) e enviar de fato os avisos que a Fase 2A deixa na fila.

**Architecture:** Cada rota é um arquivo fino em `src/app/api/v1/**/route.ts` criado por `defineRoute`, que resolve a chave de app e a conta, confere CORS e limite de requisições, autentica o token, valida a entrada com Zod, chama UMA função de domínio e serializa a resposta. Nenhuma regra de negócio mora na rota. O envio de avisos é um processo interno que reserva linhas da fila com `FOR UPDATE SKIP LOCKED`, reconfere a situação e entrega por canais plugáveis (e-mail, push), com versões simuladas para desenvolvimento.

**Tech Stack:** a mesma das fases anteriores, mais `jose` (JWT) e `nodemailer` (SMTP). Nenhuma outra dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-13-agendaflui-design.md` — seções 5, 8.4, 9.2 e 9.3. Pendências herdadas: `docs/superpowers/pendencias-proximas-fases.md`, seção "Fase 2B".

## Global Constraints

- Tudo o que vale nas fases anteriores continua valendo (ver `AGENTS.md`): TypeScript estrito; data e hora só por `src/server/time/`; domínio recebe `ctx` e usa `ctx.db` e `ctx.clock()`; `z` vem de `@/server/domain/errors`; nenhum termo do sistema antigo; textos em pt-BR; commits locais, nunca `git push`; sem formatador automático.
- A API responde só no host da API (`API_HOST`), sob `/v1/*` (o proxy reescreve para `/api/v1/*`). Toda rota exige o cabeçalho `X-App-Key`, exceto `GET /v1/health` e `GET /v1/openapi.json`.
- Toda resposta de erro tem o formato `{ "error": { "code", "reason"?, "message", "fields"?, "details"? } }`. Códigos e status HTTP: `validation` 422, `unauthorized` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `rate_limited` 429 (com `Retry-After`), `module_disabled` 404, `business_unavailable` 503, `internal` 500 (mensagem genérica, sem detalhe interno).
- Instantes na API são texto ISO 8601 em UTC (`toIsoInstant`). Todo instante vem acompanhado dos rótulos locais prontos (`local.date`, `local.start`, `local.end`, ou `label`). O app nunca faz conta de fuso e devolve o mesmo instante que recebeu.
- Rota não contém regra de negócio: valida, autentica e chama o domínio. Rota não importa o `prisma` cru nem `tenantDb`.
- Segredos (chave de app, tokens, códigos, senhas) nunca são gravados em texto, nunca vão para log, mensagem de erro, auditoria ou métrica. No banco só o hash.
- Respostas a pedidos sem login que dependem de um e-mail existir (cadastro, esqueci a senha) são idênticas exista o e-mail ou não.
- Nenhuma rota de módulo opcional nesta fase (fidelidade, loja, banners, vouchers são da Fase 5).
- Tabela nova de conta segue a regra de `business_id`, FK composta e classificação em `models.ts`.
- TDD de verdade, com o RED guardado. Testes de rota chamam o handler exportado com um `Request` montado, sem subir servidor.
- Não criar arquivos de documentação além dos listados; a referência da API é o OpenAPI gerado.

## Review Focus

1. **Token de uma conta usado com a chave de outra conta** (ou token de cliente em rota de equipe): recusado com 401/403, nunca atende. Teste na Tarefa 6.
2. **Corpo malformado** (JSON inválido, corpo vazio em POST, campo com tipo errado, campo desconhecido, corpo acima de 100 KB): 422 (ou 413) com `fields`, nunca 500. Teste na Tarefa 6.
3. **Token de renovação usado duas vezes** (app em dois aparelhos, ou token roubado): a segunda tentativa falha e a família inteira é revogada; o usuário faz login de novo. Teste na Tarefa 5.
4. **Mesmo pedido de marcação enviado duas vezes** (rede lenta, duplo toque): um agendamento só; a segunda resposta é `slot_taken` (ou devolve o mesmo agendamento se o app mandar a mesma chave de idempotência). Teste na Tarefa 9.
5. **Aviso na fila para algo que mudou** (agendamento cancelado, cliente sem e-mail, membro desativado, lembrete de horário que já passou, canal desligado pelo cliente): não é enviado; fica `SKIPPED` com o motivo. Teste na Tarefa 12.

---

## Mapa de arquivos

```
prisma/schema.prisma, prisma/migrations/<ts>_api/      tabelas da API
src/shared/theme/{color,derive}.ts                     tema, sem dependência de servidor nem de UI
src/server/domain/scheduling/…                         ajustes (canal, nota do cliente, prazo, dias livres)
src/server/domain/customers/account.ts                 cadastro, verificação, senha, exclusão
src/server/domain/platform/api-keys.ts                 chaves de app
src/server/auth/{api-tokens,rate-limit-db,client-ip,customer-context,staff-app-auth}.ts
src/server/api/{define-route,errors,serialize,cors,registry,openapi,usage}.ts
src/app/api/v1/**/route.ts                             rotas
src/server/notifications/{worker,claim,rules,render,channels/*}.ts
src/instrumentation.ts                                 validação do ambiente e agendador
scripts/worker-once.ts
tests/unit/**, tests/integration/api/**, tests/integration/notifications/**
```

---

### Task 1: Ajustes do domínio para a API

**Files:**
- Move: `src/ui/theme/color.ts`, `src/ui/theme/derive.ts` → `src/shared/theme/` (os arquivos antigos passam a reexportar)
- Modify: `prisma/schema.prisma` + migração `<ts>_appointment_customer_note`, `src/server/auth/actor.ts`, `src/server/auth/context.ts`, `src/server/domain/errors.ts`, `src/server/domain/scheduling/{appointment-view,appointments,availability}.ts`, `eslint.config.mjs`
- Test: `tests/integration/appointments-api-shape.test.ts`, `tests/integration/available-days.test.ts`, `tests/unit/domain-reasons.test.ts`

**Interfaces:**
- Produces:

```ts
// auth/actor.ts
export type Channel = 'app' | 'panel' | 'system'
export type TenantContext = { /* como hoje */ channel: Channel }      // padrão 'panel'
// domain/errors.ts
export const DOMAIN_REASONS = [ /* todos os `reason` usados no domínio hoje, levantados por grep */ ] as const
export type DomainReason = (typeof DOMAIN_REASONS)[number]
// DomainError.reason passa a ser DomainReason | undefined; `new DomainError(code, msg, { reason })` só aceita valores da lista
// scheduling/appointment-view.ts — AppointmentView ganha:
//   customerNote: string | null                       (escrita pelo cliente ao marcar; visível ao cliente e à equipe)
//   change: { allowed: boolean; until: Date | null; untilLabel: string | null }   (prazo do cliente para cancelar ou remarcar)
// scheduling/availability.ts
export function listAvailableDays(ctx: TenantContext, q: { from: string; to: string; serviceIds: string[]; professionalId?: string | null }):
  Promise<{ date: string; weekday: Weekday; available: boolean }[]>
```

Regras: `appointments.customer_note text` (até 500 caracteres). Em `bookAppointment`, o campo de entrada do ator `customer` passa a ser `customerNote`; `notes` (interno) só é aceito da equipe (cliente enviando `notes` → `forbidden`). `AppointmentView.notes` continua interno. `source` do agendamento passa a vir de `ctx.channel` (`'app'` → `APP`; senão `PANEL`), não do tipo de ator. `change.until = startsAt − customerChangeWindowMin`; `allowed` é verdadeiro quando a situação é `PENDING`/`CONFIRMED` e `ctx.clock() <= until`; `untilLabel` por `formatDateTime` no fuso da conta; para a equipe, `allowed` segue a situação e `until` vem igual. `listAvailableDays`: intervalo de até 31 dias, mesmas validações de `getAvailability`, com número de consultas que não cresce com os dias (carrega a ocupação do intervalo de uma vez e roda `computeSlots` por dia e por profissional); `available` é "existe pelo menos um início livre". Regra de lint nova: `src/server/**` não importa de `@/ui/**`.

Três ajustes herdados da re-revisão final da Fase 2A, nesta mesma tarefa: (1) `undoOutcome` (voltar de `COMPLETED`/`NO_SHOW` para `CONFIRMED`) é recusado com `conflict` (`reason: 'customer_gone'`) quando o cliente do agendamento está arquivado ou anonimizado; (2) `anonymizeCustomer` e `archiveCustomer` releem o cliente DEPOIS de travá-lo (`$lockKey('customer', id)`) e só então decidem, para duas chamadas simultâneas não auditarem duas vezes; (3) em `cancelWithinTransaction`, o sinal `notifyProfessional` deixa de viajar como o número `1` dentro de `eventExtra` e passa a ser um campo booleano tipado.

- [ ] **Step 1: Testes que falham:** desfazer a conclusão de um atendimento de cliente anonimizado (ainda em andamento) → `conflict` `customer_gone`, idem arquivado; duas anonimizações simultâneas gravam uma só auditoria `customer.anonymized`; agendamento marcado com `ctx.channel: 'app'` por ator de equipe grava `source 'APP'`, e por `'panel'` grava `PANEL`; cliente marca com `customerNote: 'Tem medo de secador'` e lê o texto de volta, a equipe também lê; cliente enviando `notes` recebe `forbidden`; `change.until` é `startsAt − 120 min` com os padrões, `allowed` vira falso um minuto depois do prazo e para agendamento cancelado; `untilLabel` no fuso de Manaus; `listAvailableDays` de segunda a domingo devolve 7 dias com `available: false` no dia fechado, no dia sem expediente e num dia lotado, e faz o mesmo número de consultas para 1 e para 7 dias; intervalo de 32 dias → `validation`; `DOMAIN_REASONS` contém todo `reason` que aparece em `src/server/domain/**` (o teste lê os arquivos e compara); os testes de tema existentes continuam passando pelos caminhos antigos e novos.
- [ ] **Step 2:** Rodar → FALHA. Implementar. `npm run typecheck && npm run lint && npm test && npm run build` → verde.
- [ ] **Step 3:** Commit: `feat: domínio pronto para a API (canal, nota do cliente, prazo de alteração, dias livres)`.

---

### Task 2: Tabelas da API

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`
- Create: `prisma/migrations/<ts>_api/migration.sql`
- Test: `tests/integration/api-schema.test.ts`

**Interfaces:**
- Produces os modelos abaixo. Enums: `ApiKeyKind { ACCOUNT PLATFORM }`, `TokenSubject { CUSTOMER MEMBER }`, `DevicePlatform { IOS ANDROID WEB }`, `VerificationPurpose { REGISTER PASSWORD_RESET }`.

| Tabela (modelo, classe) | Colunas (além de `id`, `created_at`, `updated_at`) |
|---|---|
| `api_keys` (`ApiKey`, PLATFORM) | `business_id?` → businesses (cascade), `kind ApiKeyKind`, `name`, `prefix` único (8 caracteres), `key_hash` único, `allowed_origins text[] = '{}'`, `last_used_at?`, `revoked_at?`, `created_by_admin_id?` → platform_admins (set null). CHECK: `(kind = 'ACCOUNT') = (business_id IS NOT NULL)` |
| `refresh_tokens` (`RefreshToken`, TENANT) | `subject TokenSubject`, `customer_id?` → customers (cascade), `membership_id?` → memberships (cascade), `family_id uuid`, `token_hash` único, `expires_at`, `used_at?`, `revoked_at?`, `ip?`, `user_agent?`; índice `(business_id, family_id)`. CHECK: exatamente um de `customer_id`/`membership_id`, coerente com `subject` |
| `devices` (`Device`, TENANT) | `customer_id?` → customers (cascade), `membership_id?` → memberships (cascade), `platform DevicePlatform`, `push_token`, `last_seen_at`; único `(business_id, push_token)`. CHECK: exatamente um dono |
| `verification_codes` (`VerificationCode`, TENANT) | `purpose VerificationPurpose`, `email`, `code_hash`, `payload jsonb = '{}'`, `expires_at`, `attempts int = 0`, `consumed_at?`; índice `(business_id, purpose, email)` |
| `rate_limit_buckets` (`RateLimitBucket`, PLATFORM) | PK `key text`; `window_start timestamptz`, `count int`; sem `id`; índice em `window_start` |
| `api_usage_hourly` (`ApiUsageHourly`, PLATFORM) | `api_key_id` → api_keys (cascade), `business_id?`, `route`, `hour timestamptz`, `count int`, `error_count int`, `total_ms bigint`, `max_ms int`; único `(api_key_id, route, hour)` |

`notifications` ganha `locked_until timestamptz?` e `skip_reason text?`. FKs entre tabelas de conta são compostas com `business_id`, `ON UPDATE NO ACTION`, como na migração `…_scheduling`.

- [ ] **Step 1: Teste que falha:** chave `ACCOUNT` sem conta e `PLATFORM` com conta recusadas; token de renovação com dois donos ou nenhum recusado; `subject CUSTOMER` com `membership_id` recusado; cliente de outra conta em `refresh_tokens` e em `devices` recusado pela FK composta; mesmo `push_token` na mesma conta recusado e em contas diferentes aceito; `(api_key_id, route, hour)` repetido recusado; apagar o cliente apaga tokens e dispositivos dele; o teste de classificação dos modelos e o teste estrutural de FKs continuam passando.
- [ ] **Step 2:** Rodar → FALHA. Schema, migração (diff de schema para schema + SQL puro), classificação. Rodar → PASSA; suíte verde.
- [ ] **Step 3:** Commit: `feat: tabelas da API (chaves, tokens, dispositivos, códigos, limites, uso)`.

---

### Task 3: Limite de requisições no banco e IP do cliente

**Files:**
- Create: `src/server/auth/rate-limit-db.ts`, `src/server/auth/client-ip.ts`
- Modify: `src/server/auth/member-auth.ts`, `platform-auth.ts`, `request-info.ts`, `src/server/env.ts`, `.env.example`; remover `src/server/auth/rate-limit.ts` e seus testes se ficarem sem uso
- Test: `tests/integration/rate-limit-db.test.ts`, `tests/unit/client-ip.test.ts`; ajustar `tests/integration/auth.test.ts`

**Interfaces:**
- Produces:

```ts
// rate-limit-db.ts ('server-only'; pasta liberada para o prisma cru)
export type LimitRule = { limit: number; windowSec: number }
export function hitRateLimit(key: string, rule: LimitRule, now: Date): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }>
export function clearRateLimit(key: string): Promise<void>
export function purgeRateLimits(olderThan: Date): Promise<number>
export const LIMITS: { loginEmail: LimitRule; loginIp: LimitRule; apiKeyIp: LimitRule; authIp: LimitRule; booking: LimitRule }
//   loginEmail 5/900 s · loginIp 20/900 s · apiKeyIp 120/60 s · authIp 10/900 s · booking 20/60 s
// client-ip.ts (puro)
export function clientIp(headers: Headers, trustedHops: number): string | null
// env.ts
//   TRUSTED_PROXY_HOPS: inteiro 0..5, padrão 0
```

Regras: `hitRateLimit` é uma única instrução SQL atômica (upsert que zera a contagem quando a janela venceu e incrementa senão); janela fixa por chave; chave com até 200 caracteres. `clientIp`: com `trustedHops = 0` ignora `X-Forwarded-For` (devolve `null`, porque o servidor Next não expõe o IP do socket ao handler; o limite por IP só vale atrás de proxy configurado); com `n > 0` devolve o n-ésimo endereço a partir do fim da lista de `X-Forwarded-For`, validado como IPv4 ou IPv6, senão `null`. Os logins do painel passam a usar `hitRateLimit` (por e-mail sempre; por IP quando houver) e `clearRateLimit` no sucesso; `retryAfterSec` chega à mensagem ("Tente de novo em N minutos."). `AuthError` ganha `retryAfterSec?`.

- [ ] **Step 1: Testes que falham:** 5 acertos permitidos e o 6º negado com `retryAfterSec` entre 1 e 900; depois da janela volta a permitir; 30 chamadas em paralelo com limite 10 permitem exatamente 10; chaves diferentes não interferem; `purgeRateLimits` apaga só as vencidas; `clientIp` com `X-Forwarded-For: 'evil, 1.2.3.4, 10.0.0.1'` e 1 salto devolve `10.0.0.1`, com 2 saltos `1.2.3.4`, com 0 saltos `null`, com lixo `null`; o login do painel continua barrando na 6ª tentativa e a mensagem traz os minutos; reiniciar o processo não zera o limite (o estado está no banco).
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e e2e de entrada verdes.
- [ ] **Step 3:** Commit: `feat: limite de requisições no banco e IP do cliente atrás de proxy`.

---

### Task 4: Chaves de app

**Files:**
- Create: `src/server/domain/platform/api-keys.ts`
- Test: `tests/integration/api-keys.test.ts`

**Interfaces:**
- Produces:

```ts
export type ApiKeyView = { id: string; kind: 'ACCOUNT' | 'PLATFORM'; businessId: string | null; name: string; prefix: string
  allowedOrigins: string[]; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }
export function createApiKey(actor: PlatformAdminActor, i: { kind: 'ACCOUNT' | 'PLATFORM'; businessId?: string; name: string; allowedOrigins?: string[] }):
  Promise<{ key: ApiKeyView; secret: string }>                     // `secret` só existe aqui
export function listApiKeys(actor: PlatformAdminActor, q?: { businessId?: string }): Promise<ApiKeyView[]>
export function revokeApiKey(actor: PlatformAdminActor, id: string): Promise<void>
export function updateApiKeyOrigins(actor: PlatformAdminActor, id: string, allowedOrigins: string[]): Promise<ApiKeyView>
export type ResolvedKey = { apiKeyId: string; kind: 'ACCOUNT' | 'PLATFORM'; businessId: string; businessSlug: string; timeZone: string; allowedOrigins: string[] }
export function resolveAppKey(i: { key: string | null; businessSlug: string | null }): Promise<ResolvedKey>   // lança ApiAuthError
export class ApiAuthError extends Error { code: 'unauthorized' | 'forbidden' | 'business_unavailable'; reason: string }
```

Regras: formato da chave `afk_<a|p>_<prefixo de 8 hex>_<43 caracteres base64url>` (32 bytes aleatórios); guarda `prefix` e `sha256` da chave inteira; busca pelo prefixo e compara o hash em tempo constante. `resolveAppKey`: chave ausente, malformada, inexistente ou revogada → `unauthorized` (`reason: 'invalid_app_key'`, mesma resposta em todos os casos); chave de conta resolve a conta dela e ignora `businessSlug` se igual, e recusa (`forbidden`, `business_mismatch`) se vier outro slug; chave de plataforma exige `businessSlug` de conta existente (`not_found`→ `unauthorized` com `unknown_business`); conta que não está `ACTIVE` → `business_unavailable`. `lastUsedAt` é atualizado no máximo uma vez por minuto por chave. Origens: lista de até 20 origens `https://host[:porta]` (ou `http://localhost…`/`http://*.localhost…` para desenvolvimento), sem caminho. Todas as escritas gravam auditoria (`api_key.created`, `.revoked`, `.origins_updated`) com o ator da plataforma, nunca com o segredo.

- [ ] **Step 1: Testes que falham:** criar devolve `secret` no formato e o banco não tem o segredo em nenhuma coluna; `resolveAppKey` com o segredo certo devolve a conta; com um caractere trocado, com prefixo certo e resto errado, revogada, vazia e malformada → o mesmo `unauthorized`; chave de plataforma sem slug, com slug inexistente e com slug de conta suspensa; chave de conta com slug de outra conta → `forbidden`; `kind ACCOUNT` sem `businessId` → erro de validação; origem com caminho ou sem esquema recusada; `lastUsedAt` não é regravado em duas chamadas no mesmo minuto; auditoria sem o segredo.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: chaves de app por conta e de plataforma`.

---

### Task 5: Tokens de acesso e de renovação

**Files:**
- Create: `src/server/auth/api-tokens.ts`
- Modify: `src/server/env.ts` (recusa o `APP_SECRET` de exemplo quando `NODE_ENV=production`), `package.json` (`jose`)
- Test: `tests/unit/api-access-token.test.ts`, `tests/integration/api-refresh-token.test.ts`

**Interfaces:**
- Produces:

```ts
export type AccessClaims =
  | { kind: 'customer'; businessId: string; customerId: string }
  | { kind: 'staff'; businessId: string; membershipId: string; userId: string }
export function signAccessToken(claims: AccessClaims, now: Date): Promise<{ token: string; expiresAt: Date }>   // 15 min
export function verifyAccessToken(token: string, now: Date): Promise<AccessClaims | null>                        // null se inválido, vencido ou adulterado
export type TokenPair = { accessToken: string; accessExpiresAt: Date; refreshToken: string; refreshExpiresAt: Date }
export function issueTokens(tx: TenantClient | TenantTx, claims: AccessClaims, meta: { ip: string | null; userAgent: string | null }, now: Date): Promise<TokenPair>
export function rotateRefreshToken(businessId: string, refreshToken: string, meta: { ip: string | null; userAgent: string | null }, now: Date):
  Promise<{ claims: AccessClaims; pair: TokenPair } | null>
export function revokeRefreshToken(businessId: string, refreshToken: string): Promise<void>                      // revoga a família
export function revokeAllFor(db: TenantClient | TenantTx, subject: { customerId: string } | { membershipId: string }): Promise<number>
```

Regras: JWT HS256 com chave derivada de `APP_SECRET` por HKDF (rótulo `agendaflui/api-access/v1`), `iss` `agendaflui`, `aud` `api`, `exp` 15 min, sem dado pessoal além dos ids. `verifyAccessToken` aceita só HS256 e recusa `alg: none`. Token de renovação: 32 bytes aleatórios em base64url, validade de 60 dias, guardado só como hash; cada uso marca `usedAt` e emite um novo na mesma `familyId`; reuso de um token já usado ou revogado revoga a família inteira e devolve `null`; token de outra conta devolve `null` sem revogar nada. Tudo roda em transação com trava da linha do token (`UPDATE … WHERE used_at IS NULL` como passo de reserva) para duas rotações simultâneas não passarem as duas.

- [ ] **Step 1: Testes que falham:** assinar e verificar devolve as mesmas declarações; vencido (16 min depois), assinatura adulterada, `alg: none`, `aud` trocado e lixo → `null`; a carga do token não contém e-mail, nome nem telefone; `rotateRefreshToken` devolve par novo e o antigo deixa de valer; usar o antigo de novo devolve `null` E revoga o novo (família); 10 rotações simultâneas do mesmo token: exatamente uma passa; token da conta A com `businessId` de B → `null` e a família de A continua válida; vencido → `null`; `revokeAllFor` invalida todas as famílias do cliente; nenhum token em texto no banco; `parseEnv` com `NODE_ENV=production` e o segredo de exemplo lança.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: tokens de acesso curtos e renovação rotativa com detecção de reuso`.

---

### Task 6: Camada HTTP da API

**Files:**
- Create: `src/server/api/{define-route,errors,serialize,cors,registry}.ts`, `src/server/auth/customer-context.ts`, `src/app/api/v1/openapi.json/route.ts` (esqueleto), `tests/setup/api.ts`
- Modify: `src/app/api/v1/health/route.ts` (passa a usar `defineRoute`), `src/server/auth/context.ts`
- Test: `tests/integration/api/define-route.test.ts`, `tests/unit/api-serialize.test.ts`

**Interfaces:**
- Produces:

```ts
// api/define-route.ts
export type RouteAuth = 'none' | 'key' | 'customer' | 'staff'
export type RouteDef<P, Q, B, R> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string                         // '/v1/appointments/{id}'
  auth: RouteAuth
  summary: string; tag: string
  params?: z.ZodType<P>; query?: z.ZodType<Q>; body?: z.ZodType<B>
  response: z.ZodType<R>               // esquema da resposta de sucesso (documentação e teste de contrato)
  status?: 200 | 201 | 202 | 204
  limit?: LimitRule                    // além do limite geral por chave e IP
  handler: (c: { ctx: TenantContext | null; key: ResolvedKey | null; params: P; query: Q; body: B; request: Request; now: Date }) => Promise<R>
}
export function defineRoute<P, Q, B, R>(def: RouteDef<P, Q, B, R>): (request: Request, seg: { params: Promise<Record<string, string | string[]>> }) => Promise<Response>
// api/registry.ts
export function registeredRoutes(): readonly RouteDef<unknown, unknown, unknown, unknown>[]
// api/serialize.ts
export function toJson(value: unknown): unknown        // Date → ISO por toIsoInstant; bigint → número se seguro; undefined some; nada de classes
// api/errors.ts
export function errorResponse(err: unknown, request: Request): Response
// auth/customer-context.ts
export function createCustomerContext(i: { businessId: string; customerId: string; request: RequestInfo; clock?: () => Date }): Promise<TenantContext>
//   lança ApiAuthError('unauthorized', 'session_invalid') se o cliente não existe, é de outra conta, está arquivado ou anonimizado
// tests/setup/api.ts
export function apiRequest(method: string, path: string, o?: { key?: string; business?: string; token?: string; body?: unknown; origin?: string; headers?: Record<string, string> }): Request
export function callRoute(handler: Function, req: Request, params?: Record<string, string>): Promise<{ status: number; headers: Headers; json: any }>
export function makeAppKey(businessId: string | null, o?: { allowedOrigins?: string[] }): Promise<{ secret: string; id: string }>
export function customerToken(businessId: string, customerId: string): Promise<string>
export function staffToken(businessId: string, membershipId: string, userId: string): Promise<string>
```

Ordem dentro de `defineRoute`: `OPTIONS` (pré-voo CORS) → chave de app (`X-App-Key`, `X-Business`) → CORS (se há `Origin`: precisa estar em `allowedOrigins`, senão 403 `origin_not_allowed`; sem `Origin`, segue) → limite geral (`apiKeyIp`, chave do limite `api:<apiKeyId>:<ip ou 'sem-ip'>`) e o da rota → token (`Authorization: Bearer`): o `businessId` do token tem de ser o da chave, e o tipo tem de ser o exigido (`customer` ou `staff`) → contexto (`createCustomerContext` ou, para equipe, `createTenantContext` com vínculo ativo relido do banco), com `channel: 'app'` → `params`, `query` e `body` validados (corpo JSON de até 100 KB; `strict`: campo desconhecido é erro) → `handler` → `toJson` → resposta com `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`, cabeçalhos CORS quando houver `Origin`. `DomainError`, `ApiAuthError`, `AuthError` e erro de validação viram a resposta de erro padrão; qualquer outro erro vira 500 `internal` com mensagem genérica e é registrado no log do servidor sem dados da requisição que sejam segredo. Cada rota definida se registra em `registry.ts`.

- [ ] **Step 1: Testes que falham** (com uma rota de teste definida no próprio arquivo): sem chave → 401 `invalid_app_key`; chave de plataforma sem `X-Business` → 401; origem não permitida → 403; pré-voo `OPTIONS` de origem permitida → 204 com `Access-Control-Allow-Origin` igual à origem, `Allow-Headers` com `authorization, content-type, x-app-key, x-business` e `Vary: Origin`; rota `customer` sem token → 401; com token de equipe → 403 `wrong_token_kind`; com token de cliente da conta B e chave da conta A → 401; com cliente arquivado → 401 `session_invalid`; rota `staff` com vínculo desativado → 401; JSON inválido → 422 com `fields._`; corpo vazio em POST que exige corpo → 422; campo desconhecido → 422; tipo errado → 422 com o campo; corpo de 101 KB → 413; erro inesperado no handler → 500 `internal` sem a mensagem original; `DomainError('conflict', …, { reason: 'slot_taken', details })` → 409 com `reason` e `details` serializados (datas em ISO); 121ª requisição no minuto → 429 com `Retry-After`; resposta de sucesso com `Date` sai em ISO UTC; `GET /v1/health` responde sem chave; `ctx.channel` é `'app'`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: camada HTTP da API com chave, CORS, limites, tokens e erros padronizados`.

---

### Task 7: Conta do cliente (cadastro, entrada, senha, exclusão)

**Files:**
- Create: `src/server/domain/customers/account.ts`, `src/app/api/v1/auth/customer/{register,verify,login,refresh,logout}/route.ts`, `src/app/api/v1/auth/customer/password/{forgot,reset}/route.ts`
- Modify: `src/server/domain/customers/customers.ts` (`anonymizeCustomer` revoga tokens, apaga dispositivos e códigos), `src/server/domain/notifications/outbox.ts` (enfileirar e-mail de código)
- Test: `tests/integration/api/customer-account.test.ts`

**Interfaces:**
- Consumes: Tarefas 3, 5 e 6; `normalizeEmail`, `normalizePhone`, `passwordSchema`, `hashPassword`, `verifyPassword`.
- Produces (domínio, chamado pelas rotas com a conta já resolvida pela chave):

```ts
export function requestRegistration(businessId: string, i: { name: string; email: string; phone?: string | null; password: string }, meta: RequestMeta, now: Date): Promise<void>
export function confirmRegistration(businessId: string, i: { email: string; code: string }, meta: RequestMeta, now: Date): Promise<{ customerId: string; pair: TokenPair }>
export function loginCustomer(businessId: string, i: { email: string; password: string }, meta: RequestMeta, now: Date): Promise<{ customerId: string; pair: TokenPair }>
export function requestPasswordReset(businessId: string, email: string, meta: RequestMeta, now: Date): Promise<void>
export function resetPassword(businessId: string, i: { email: string; code: string; password: string }, meta: RequestMeta, now: Date): Promise<void>
export function changePassword(ctx: TenantContext, i: { current: string; next: string }): Promise<void>
export function deleteOwnAccount(ctx: TenantContext, i: { password: string }): Promise<void>
```

Rotas (todas `auth: 'key'`, limite `authIp`): `POST /v1/auth/customer/register` → 202 `{ status: 'verification_sent' }`; `/verify` → 200 `{ tokens, customer }`; `/login` → 200 `{ tokens, customer }`; `/refresh` (corpo `{ refreshToken }`) → 200 `{ tokens }`; `/logout` → 204; `/password/forgot` → 202; `/password/reset` → 204.

Regras: o cadastro NÃO cria o cliente; grava um `verification_codes` (`REGISTER`) com `payload` contendo nome, telefone normalizado e o hash da senha, e enfileira o e-mail com o código. A confirmação cria o cliente (`origin: APP`, `emailVerifiedAt`), ou assume um cadastro existente da conta com o mesmo e-mail e SEM senha (o do balcão): mantém nome, histórico e observações, grava a senha e `emailVerifiedAt`. Se o e-mail já pertence a um cliente COM senha, o pedido de cadastro responde igual (202) e o e-mail enviado diz que a conta já existe e como recuperar a senha; nenhum código de cadastro é criado. Código: 6 dígitos, validade de 15 minutos, no máximo 5 tentativas erradas (depois o código morre), um código vivo por e-mail e propósito (pedir de novo substitui), guardado como HMAC-SHA256 com chave derivada de `APP_SECRET`. Login: mesmo erro (`unauthorized`, `invalid_credentials`) para e-mail inexistente, senha errada, cliente sem senha, arquivado ou anonimizado, com verificação contra hash fixo para igualar o tempo; limites `loginEmail` e `loginIp`. Esqueci a senha: sempre 202; só envia código se houver cliente ativo com senha ou cadastro de balcão com aquele e-mail. Redefinir ou trocar a senha revoga todos os tokens de renovação do cliente. `deleteOwnAccount`: confere a senha, chama `anonymizeCustomer` e revoga tudo. `anonymizeCustomer` passa a apagar `refresh_tokens`, `devices` e `verification_codes` do cliente na mesma transação.

- [ ] **Step 1: Testes que falham:** cadastro novo → 202, nenhuma linha em `customers`, um código pendente, um aviso de e-mail na fila sem o código em texto na coluna `payload` (o código viaja cifrado ou é gerado de novo no envio: escolha a forma em que o banco nunca guarda o código em texto e documente); confirmar com o código certo cria o cliente e devolve tokens válidos; código errado 5 vezes mata o código; código vencido falha; e-mail de cliente com senha → 202 idêntico e nenhum código de cadastro; e-mail de cliente do balcão → confirmar assume o cadastro (mesmo `id`, histórico preservado) e grava a senha; duas confirmações simultâneas do mesmo código: uma passa; login com e-mail em maiúsculas entra; senha errada e e-mail inexistente dão a mesma resposta e status; 6ª tentativa → 429; cliente arquivado não entra; renovação rotaciona e o reuso derruba a família (via rota); esqueci a senha para e-mail inexistente → 202 e nada na fila; redefinir a senha invalida os tokens antigos; excluir a conta com senha errada → 401/403 e nada muda; com a senha certa anonimiza, cancela os agendamentos futuros, e o token de acesso deixa de funcionar na requisição seguinte; mesmo e-mail em outra conta é independente.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: conta do cliente pelo app (cadastro com confirmação, entrada, senha, exclusão)`.

---

### Task 8: Entrada da equipe pelo app

**Files:**
- Create: `src/server/auth/staff-app-auth.ts`, `src/app/api/v1/auth/staff/{login,refresh,logout}/route.ts`, `src/app/api/v1/staff/me/route.ts`
- Test: `tests/integration/api/staff-auth.test.ts`

**Interfaces:**
- Produces:

```ts
export function loginStaff(businessId: string, i: { email: string; password: string }, meta: RequestMeta, now: Date):
  Promise<{ pair: TokenPair; member: { userId: string; membershipId: string; name: string; role: MembershipRole; professionalId: string | null } }>
```

Regras: a conta vem da chave de app; o usuário precisa ter vínculo ATIVO nela (senão o mesmo `invalid_credentials`); usa os mesmos limites de login; `lastLoginAt` atualizado. `GET /v1/staff/me` devolve nome, e-mail, papel, rótulo do papel com o termo da conta, `professionalId` e as capacidades do ator (lista de `Capability`). Desativar o vínculo ou suspender a conta derruba o acesso na requisição seguinte (o contexto relê) e a renovação falha.

- [ ] **Step 1: Testes que falham:** dono entra e `staff/me` devolve papel `OWNER` e todas as capacidades; profissional devolve as 5 básicas e o `professionalId` ligado; usuário sem vínculo na conta da chave → 401 idêntico a senha errada; vínculo desativado depois do login → 401 na rota seguinte e na renovação; token de equipe em rota de cliente → 403; conta suspensa → 503 `business_unavailable`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: entrada da equipe pelo app`.

---

### Task 9: Rotas públicas e do cliente

**Files:**
- Create: `src/server/domain/platform/public-business.ts` e as rotas em `src/app/api/v1/`: `business`, `services`, `professionals`, `availability`, `availability/days`, `me`, `me/password`, `me/notifications`, `me/devices`, `appointments`, `appointments/next`, `appointments/[id]`, `appointments/[id]/cancel`, `appointments/[id]/reschedule`; `src/server/domain/customers/devices.ts`, `src/server/domain/customers/preferences.ts`
- Test: `tests/integration/api/public-routes.test.ts`, `tests/integration/api/customer-routes.test.ts`

**Interfaces:**
- Consumes: domínio da Fase 2A e Tarefas 1, 6 e 7.
- Rotas e respostas (campos exatos; tudo passa por `toJson`):

| Rota | Auth | Domínio | Resposta |
|---|---|---|---|
| `GET /v1/business` | key | `getPublicBusiness` | `{ id, slug, name, timeZone, brand: { logoUrl, symbolUrl, primary, accent, material, paper, fontPair, tokens }, terms: { professional: { singular, plural }, customer: {…}, points: {…}, club }, modules: { loyalty, banners, store, vouchers }, rules: { slotStepMin, minLeadMin, maxAdvanceDays, customerChangeWindowMin } }` |
| `GET /v1/services` | key | `listServices` | `{ items: ServiceView[] }` (sem inativos nem arquivados) |
| `GET /v1/professionals?serviceIds=a,b` | key | `listProfessionals` | `{ items: [{ id, name, bio, avatarUrl, serviceIds }] }` |
| `GET /v1/availability?date&serviceIds&professionalId` | key (token de cliente opcional) | `getAvailability` | `AvailabilityView` |
| `GET /v1/availability/days?from&to&serviceIds&professionalId` | key (token opcional) | `listAvailableDays` | `{ items }` |
| `GET /v1/me` · `PATCH /v1/me` | customer | `getCustomer`/`updateCustomer` | `CustomerView` sem `notes` |
| `PUT /v1/me/password` | customer | `changePassword` | 204 |
| `DELETE /v1/me` (corpo `{ password }`) | customer | `deleteOwnAccount` | 204 |
| `GET` · `PUT /v1/me/notifications` | customer | `preferences` | `{ pushAppointments, emailAppointments, pushMarketing, emailMarketing }` |
| `POST /v1/me/devices` · `DELETE /v1/me/devices/{pushToken}` | customer | `devices` | 204 |
| `GET /v1/appointments?scope&cursor&limit` | customer | `listCustomerAppointments` | `{ items, nextCursor }` |
| `GET /v1/appointments/next` | customer | `getNextAppointment` | `{ appointment: AppointmentView \| null }` |
| `POST /v1/appointments` | customer, limite `booking` | `bookAppointment` | 201 `AppointmentView` |
| `GET /v1/appointments/{id}` | customer | `getAppointment` | `AppointmentView` |
| `POST /v1/appointments/{id}/cancel` | customer | `cancelAppointment` | `AppointmentView` |
| `POST /v1/appointments/{id}/reschedule` | customer | `rescheduleAppointment` | `AppointmentView` |

Regras: as rotas sem login montam um contexto de visitante: ator `customer` não serve (não há cliente); use um ator novo `{ kind: 'guest' }` (acrescente ao tipo `Actor`; `can()` devolve `false`; no domínio, `guest` enxerga o mesmo que o cliente em serviços, profissionais e disponibilidade, é tratado como cliente comum, sem clube, na disponibilidade, e recebe `forbidden` em todo o resto). Quando há token de cliente em `/availability`, o contexto é o do cliente (vale o clube). `POST /v1/appointments` aceita o cabeçalho `Idempotency-Key` (até 80 caracteres): a mesma chave do mesmo cliente dentro de 24 horas devolve o MESMO agendamento com status 200, sem marcar de novo (guarde a chave numa coluna única `idempotency_key` de `appointments`, por cliente; migração nesta tarefa). `me/devices`: `{ platform, pushToken }`; o mesmo `pushToken` na conta passa a pertencer ao último que registrou. `AppointmentView` para o cliente: sem `commissionCents`, sem `notes`, com `customerNote` e `change`. `getPublicBusiness` devolve só o que a tabela mostra (nunca documento, contato interno ou observações) e `brand.tokens` são as variáveis de tema derivadas (`deriveTheme`, do módulo neutro).

- [ ] **Step 1: Testes que falham:** `GET /v1/business` devolve os termos e os módulos da conta e não contém `internalNotes`, `document`, `email` nem `phone` (compare as chaves com a lista esperada); `services` não traz inativo; `professionals` não traz `commissionBps` nem `membershipId`; `availability` sem token funciona e esconde serviço do clube (`forbidden`), com token de cliente do clube mostra; os inícios vêm em ISO UTC com `label` local; conta em Manaus: 09:00 local é `13:00:00.000Z`; `POST /appointments` com o `startsAt` devolvido pela disponibilidade → 201 e `local.start` igual ao `label`; a mesma requisição de novo sem chave de idempotência → 409 `slot_taken`; com a mesma `Idempotency-Key` → 200 com o mesmo `id` e um só agendamento no banco; `startsAt` fora da disponibilidade → 409 `slot_unavailable`; cancelar dentro do prazo funciona e fora dele → 409 `too_late` com mensagem que diz o prazo; cliente A lendo, cancelando ou remarcando agendamento do cliente B → 404; `GET /appointments?scope=upcoming` pagina; `PATCH /me` com `notes` ou `isClubMember` → 403; `PATCH /me` com telefone `(11) 91234-5678` devolve `phoneLabel`; registrar o mesmo dispositivo por dois clientes deixa-o com o segundo; preferências gravadas e lidas; 21ª marcação no minuto → 429.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: rotas públicas e do cliente na API`.

---

### Task 10: Rotas da equipe

**Files:**
- Create: rotas em `src/app/api/v1/staff/`: `agenda`, `summary`, `appointments`, `appointments/[id]`, `appointments/[id]/{confirm,complete,no-show,undo,cancel,reschedule,adjust,free-early}`, `customers`, `customers/[id]`, `customers/[id]/appointments`, `professionals`, `services`, `working-hours/[professionalId]`, `time-blocks`, `time-blocks/[id]`, `devices`, `devices/[pushToken]`
- Test: `tests/integration/api/staff-routes.test.ts`

**Interfaces:**
- Consumes: domínio da Fase 2A, Tarefas 6 e 8.
- Cada rota chama exatamente uma função de domínio (`getAgenda`, `getDaySummary`, `bookAppointment`, `getAppointment`, `confirmAppointment`, `completeAppointment`, `markNoShow`, `undoOutcome`, `cancelAppointment`, `rescheduleAppointment`, `adjustAppointment`, `notifyProfessionalFreeEarly`, `listCustomers`, `createCustomer`, `getCustomer`, `listCustomerAppointments`, `listProfessionals`, `listServices`, `getWeekSchedule`, `setWeekSchedule`, `listTimeBlocks`, `createTimeBlock`, `deleteTimeBlock`, e o registro de dispositivo). As permissões são as do domínio; a rota não decide nada.

Regras: todas `auth: 'staff'`. `GET /v1/staff/agenda?from&to&professionalId` devolve `{ days: AgendaDay[] }`. As ações sobre agendamento são `POST` e devolvem a `AppointmentView` atualizada. `expediente`: `PUT /v1/staff/working-hours/{professionalId}` com `{ MONDAY: [{ start: '09:00', end: '12:00' }], … }` em rótulos `HH:mm` (a rota converte para minutos com `parseMinuteLabel` e devolve com rótulos e minutos). Bloqueio: `POST /v1/staff/time-blocks` com `{ professionalId, date, start, end, reason }` em data e horas locais (a rota converte com `toInstant`; `end` menor ou igual a `start` significa o dia seguinte só se `end` for `'00:00'`... não: aceite também `endDate` opcional para bloqueios de vários dias) e devolve `affectedAppointments`.

- [ ] **Step 1: Testes que falham:** gerente vê a agenda de todos e o profissional só a própria coluna (pedindo a de um colega → 403); marcar pela equipe fora da grade → 201 com `source 'APP'` (o canal é o app); sobre agendamento existente → 409 `slot_taken` com `details.nearest` em ISO e com rótulos; concluir antes do início → 409 `too_early`; concluir devolve `commissionCents` para o gerente e para o próprio profissional, e `null` para outro profissional lendo depois; `adjust` com `totalCents` por profissional → 403; `free-early` duas vezes → um aviso só; buscar cliente por "joao" acha "João"; criar cliente pelo profissional → 403; expediente enviado com `'09:00'` volta com `startMin 540`; `'25:00'` → 422; bloqueio em data local de Manaus grava os instantes certos e devolve `affectedAppointments`; token de cliente em qualquer rota `staff/*` → 403.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: rotas da equipe na API`.

---

### Task 11: Documentação OpenAPI gerada

**Files:**
- Create: `src/server/api/openapi.ts`
- Modify: `src/app/api/v1/openapi.json/route.ts`
- Test: `tests/integration/api/openapi.test.ts`

**Interfaces:**
- Produces: `buildOpenApi(): object` (OpenAPI 3.1) a partir de `registeredRoutes()`: caminho, método, resumo, grupo, parâmetros, corpo e resposta (esquemas JSON por `z.toJSONSchema`), os esquemas de segurança (`AppKey` por cabeçalho, `Bearer`), o esquema de erro padrão com a lista fechada de `code` e de `reason` (`DOMAIN_REASONS` mais os da camada de API), e os servidores a partir de `API_HOST`.

- [ ] **Step 1: Testes que falham:** todo arquivo `route.ts` sob `src/app/api/v1/` exporta handlers criados por `defineRoute` e está no registro (o teste varre a pasta e compara método e caminho); o documento valida como OpenAPI 3.1 por uma checagem estrutural mínima escrita no teste (campos obrigatórios, `$ref` resolvidos); toda rota tem resumo, grupo e esquema de resposta; rotas `customer` e `staff` declaram `Bearer`; a resposta real de três rotas representativas (`business`, `availability`, `appointments` POST) valida contra o esquema declarado; `GET /v1/openapi.json` responde sem chave com `Cache-Control: public, max-age=300`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: documentação OpenAPI gerada a partir das rotas`.

---

### Task 12: Envio de avisos

**Files:**
- Create: `src/server/notifications/{claim,rules,render,worker}.ts`, `src/server/notifications/channels/{types,email-smtp,email-file,push-expo,push-file}.ts`, `src/instrumentation.ts`, `scripts/worker-once.ts`
- Modify: `src/server/env.ts` e `.env.example` (`SMTP_URL?`, `MAIL_FROM`, `EXPO_ACCESS_TOKEN?`, `WORKER_ENABLED`, padrão `true`), `eslint.config.mjs` (libera o `prisma` cru em `src/server/notifications/**`), `package.json` (`nodemailer`, script `worker:once`)
- Test: `tests/integration/notifications/{claim,rules,worker}.test.ts`, `tests/unit/notification-render.test.ts`

**Interfaces:**
- Produces:

```ts
// channels/types.ts
export type EmailMessage = { to: string; fromName: string; subject: string; html: string; text: string }
export type PushMessage = { tokens: string[]; title: string; body: string; data: Record<string, string> }
export interface EmailChannel { send(m: EmailMessage): Promise<void> }
export interface PushChannel { send(m: PushMessage): Promise<{ invalidTokens: string[] }> }
export function getChannels(): { email: EmailChannel | null; push: PushChannel | null }
// claim.ts
export function claimDue(now: Date, limit: number): Promise<{ id: string; businessId: string }[]>     // FOR UPDATE SKIP LOCKED + locked_until = now + 2 min
// rules.ts
export type Decision = { action: 'send' } | { action: 'skip'; reason: string }
export function decide(n: LoadedNotification, now: Date): Decision
// render.ts
export function renderNotification(n: LoadedNotification): { email?: Omit<EmailMessage, 'to' | 'fromName'>; push?: Omit<PushMessage, 'tokens'> }
// worker.ts
export function processDueNotifications(o?: { now?: Date; limit?: number; channels?: ReturnType<typeof getChannels> }): Promise<{ sent: number; skipped: number; failed: number; retried: number }>
```

Regras de envio: reserva até 50 linhas `PENDING` com `scheduled_for <= agora` e (`locked_until` nulo ou vencido), em ordem de `scheduled_for`. Para cada uma, recarrega agendamento, cliente, membro e conta, e decide:
- conta que não está `ACTIVE` → `skip` (`business_inactive`);
- tipo desligado para o canal nas configurações da conta → `skip` (`disabled_by_business`);
- destinatário cliente: arquivado ou anonimizado → `skip` (`recipient_gone`); preferência do cliente desligada para o canal (avisos de agendamento usam `notify*Appointments`) → `skip` (`disabled_by_recipient`); e-mail sem endereço → `skip` (`no_email`); push sem dispositivo → `skip` (`no_device`);
- destinatário membro: vínculo inativo → `skip` (`recipient_gone`); e-mail vem do usuário do vínculo; push dos dispositivos do vínculo;
- por tipo, a situação do agendamento precisa bater: `APPOINTMENT_REQUESTED` só se `PENDING`; `APPOINTMENT_CONFIRMED` e os lembretes só se `CONFIRMED`; `APPOINTMENT_RESCHEDULED` e `STAFF_APPOINTMENT_RESCHEDULED` só se `PENDING`/`CONFIRMED` e se o `startsAt` do `payload` ainda é o atual; `APPOINTMENT_CANCELED` e `STAFF_APPOINTMENT_CANCELED` só se `CANCELED` (o de equipe por troca de profissional é enviado mesmo com o agendamento ativo: o `payload` marca `reason: 'moved'`, acrescente esse campo no enfileiramento); `APPOINTMENT_COMPLETED` só se `COMPLETED`; `PROFESSIONAL_FREE_EARLY` só se `CONFIRMED` e ainda não iniciado; senão `skip` (`stale`);
- qualquer aviso (menos concluído e cancelado) de agendamento cujo `endsAt` já passou → `skip` (`past`); lembrete com mais de 30 minutos de atraso em relação ao horário previsto → `skip` (`late`);
- canal não configurado (sem `SMTP_URL` em produção, por exemplo) → falha definitiva (`not_configured`), sem nova tentativa.
Envio com sucesso → `SENT`, `sentAt`. Falha do canal → `attempts + 1` e nova tentativa em 1, 5, 15 e 60 minutos; depois da 5ª, `FAILED` com `lastError` (mensagem curta, sem dados pessoais). Tokens de push inválidos devolvidos pelo canal são apagados de `devices`. Uma linha nunca é enviada duas vezes: a atualização final confere que a linha ainda está `PENDING` e reservada por este processo.

Canais: `email-smtp` (nodemailer com `SMTP_URL`), `email-file` (grava `.eml` em `.local/mail/`), `push-expo` (`POST https://exp.host/--/api/v2/push/send`, com `EXPO_ACCESS_TOKEN` quando houver, lotes de 100), `push-file` (grava JSON em `.local/push/`). `getChannels()`: em `NODE_ENV=test` nenhum canal real (os testes injetam canais falsos); em desenvolvimento, sempre os de arquivo; em produção, os reais quando configurados, senão `null`.

Textos (`render.ts`, pt-BR, com os termos e o nome da conta, data e hora no fuso da conta por `formatDateTime`): um assunto e um corpo por tipo, curtos e diretos, por exemplo confirmado: assunto "Agendamento confirmado: {serviço} em {data} às {hora}", corpo com profissional, serviços, total em reais, o prazo para cancelar e o nome do negócio. O e-mail em HTML usa a cor principal e o nome da conta no cabeçalho (cores derivadas pelo módulo neutro de tema, com contraste garantido), tabela simples, largura máxima de 600 px, e sempre tem a versão em texto puro. O código de verificação e o de redefinição de senha (Tarefa 7) também passam por aqui.

Agendador: `src/instrumentation.ts` valida o ambiente na partida (`parseEnv`) e, no runtime Node com `WORKER_ENABLED`, roda `processDueNotifications` a cada 60 segundos, sem sobrepor execuções, e uma vez por hora limpa `rate_limit_buckets` vencidos, códigos de verificação vencidos e tokens de renovação vencidos há mais de 7 dias. Erro numa rodada é registrado e não derruba o processo. `npm run worker:once` roda uma rodada e sai.

- [ ] **Step 1: Testes que falham:** `claimDue` com dois processos simultâneos nunca entrega a mesma linha aos dois; linha com `locked_until` no futuro não é reservada, vencido é; cada regra de `decide` com um caso que envia e um que pula (tabela de casos, incluindo os cinco do Review Focus: cancelado, sem e-mail, membro desativado, lembrete atrasado, canal desligado pelo cliente); `processDueNotifications` com canais falsos: envia o confirmado e marca `SENT`; falha do canal agenda a nova tentativa em 1 minuto e, na 5ª falha, marca `FAILED`; canal `null` → `FAILED` `not_configured` sem nova tentativa; token de push inválido é apagado; rodar duas vezes seguidas não reenvia; os ~70 avisos pendentes do seed de demonstração (rode o seed no teste com relógio fixo): os de agendamentos passados viram `SKIPPED` (`past` ou `stale`) e nenhum e-mail sai para eles; `renderNotification` de cada tipo produz assunto e texto sem `undefined`, sem `{`, com a hora no fuso da conta (Manaus) e o termo da conta ("Tosador"), e o HTML escapa nome com `<script>`; o texto de cancelamento por equipe inclui o motivo; `instrumentation` não inicia o agendador com `WORKER_ENABLED=false`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde. Verificação manual: `npm run db:reset`, `npm run dev`, esperar uma rodada, conferir que `.local/mail/` recebeu só os e-mails de agendamentos futuros de clientes com e-mail, abrir um `.eml` e ler; encerrar.
- [ ] **Step 3:** Commit: `feat: envio de avisos com reserva segura, regras de descarte e canais plugáveis`.

---

### Task 13: Métricas de uso da API

**Files:**
- Create: `src/server/api/usage.ts`
- Modify: `src/server/api/define-route.ts`, `src/instrumentation.ts`
- Test: `tests/integration/api/usage.test.ts`

**Interfaces:**
- Produces:

```ts
export function recordUsage(e: { apiKeyId: string; businessId: string | null; route: string; ms: number; error: boolean; at: Date }): void   // só memória, nunca lança
export function flushUsage(): Promise<number>                                                                                             // grava por upsert incremental e esvazia
export function usageSummary(actor: PlatformAdminActor, q: { from: Date; to: Date; apiKeyId?: string; businessId?: string }):
  Promise<{ route: string; count: number; errorCount: number; avgMs: number; maxMs: number }[]>
```

Regras: `defineRoute` chama `recordUsage` depois de responder, com o caminho-modelo da rota (`/v1/appointments/{id}`, nunca o caminho real com ids); `error` é status 5xx ou 4xx que não seja 401, 404, 409, 422 nem 429 (esses são uso normal). O agendador chama `flushUsage` a cada 30 segundos e ao encerrar o processo (`SIGTERM`). A hora é truncada em UTC por função do módulo de tempo. Falha ao gravar métrica nunca derruba a requisição nem perde mais que o lote corrente.

- [ ] **Step 1: Testes que falham:** três chamadas a uma rota e um erro 500 viram uma linha com `count 4`, `errorCount 1`, `maxMs` e `totalMs` coerentes; chamadas em horas diferentes viram linhas diferentes; dois `flushUsage` seguidos somam em vez de sobrescrever; o caminho gravado é o modelo, sem ids; 401 e 422 não contam como erro; requisição sem chave válida não grava métrica; `usageSummary` agrega por rota e exige admin da plataforma.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: métricas de uso da API por chave, rota e hora`.

---

### Task 14: Chaves de demonstração, teste de ponta a ponta e fechamento

**Files:**
- Modify: `prisma/seed.ts` (uma chave de conta por conta de demonstração e uma chave de plataforma; os segredos são gravados em `.local/demo-keys.json`, nunca impressos), `README.md`, `.env.example`, `docs/superpowers/pendencias-proximas-fases.md` (tirar o que esta fase resolveu)
- Create: `tests/e2e/api.spec.ts`
- Test: `tests/e2e/api.spec.ts`, `tests/integration/seed.test.ts`

Fluxo do teste de ponta a ponta (Playwright `request`, contra o servidor real, com `http://127.0.0.1:3000` e o cabeçalho `Host` do `API_HOST`; a chave vem de `.local/demo-keys.json`): `GET /v1/health`; `GET /v1/business` com a chave do pet shop devolve os termos "Tosador"/"Tutor"; cadastro de cliente → lê o código no `.eml` gravado em `.local/mail/` → confirma → recebe tokens; `GET /v1/services` → `GET /v1/availability` de um dia útil futuro → `POST /v1/appointments` com o primeiro início → `GET /v1/appointments/next` devolve o mesmo; cancelar; a mesma chave no host do painel (`Host` do `PAINEL_HOST`) em `/v1/health` → 404; `GET /v1/openapi.json` lista as rotas usadas no teste.

- [ ] **Step 1:** Teste e2e e teste do seed (as chaves existem, uma por conta mais a de plataforma; rodar o seed de novo não cria chaves novas; o arquivo `.local/demo-keys.json` tem os três segredos e o banco não tem nenhum) → FALHA. Implementar.
- [ ] **Step 2: Verificação final da fase:** `npm run typecheck && npm run lint && npm test && npm run test:tz && npm run build`; os arquivos de corrida 3 vezes; com as portas 3000 e 54329 livres (se houver servidor que não é seu, não o encerre: reporte), `npm run db:reset && npm run test:e2e`. Não apague a pasta `.local` inteira. `grep -rn "from '@/server/db/client'" src/app` → vazio. `grep -rniE "sejasans|sans (company|club|coins)|clube_sans|barber" src prisma scripts tests` → vazio.
- [ ] **Step 3:** README: seção curta "API" (onde está o OpenAPI, como achar as chaves de demonstração, onde caem os e-mails em desenvolvimento, variáveis novas), mantendo o arquivo em até 80 linhas. Commit: `feat: chaves de demonstração e teste de ponta a ponta da API`.
