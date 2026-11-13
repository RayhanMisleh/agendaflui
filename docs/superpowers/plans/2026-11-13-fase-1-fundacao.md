# AgendaFlui — Fase 1: Fundação — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar de pé o projeto novo do AgendaFlui: base de código, banco local, isolamento entre contas, módulo de tempo, acesso aos dois painéis, arquivos, design system skeuomórfico e uma vitrine de componentes para aprovação do visual.

**Architecture:** Um projeto Next.js 16 em TypeScript que responde em três hosts (`dev.`, `painel.`, `api.`) roteados por `src/proxy.ts`. Toda regra de negócio fica em `src/server/`; telas e rotas só validam, autorizam e chamam o domínio. Dados de conta só são acessados por `tenantDb(businessId)`.

**Tech Stack:** Next 16.3.3, React 19.2.8, TypeScript 5.9, Prisma 7.10.1 (`@prisma/adapter-pg`), PostgreSQL embutido (`embedded-postgres` 18.6.0-beta.19), Zod 4, `temporal-polyfill`, `@node-rs/argon2`, `sharp`, Tailwind 4, Vitest 5, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-13-agendaflui-design.md` — leia as seções 5, 6, 7, 9.1, 10 e 11 antes de começar qualquer tarefa.

## Global Constraints

- Next.js 16 tem mudanças incompatíveis com versões anteriores. Depois do `npm install`, leia o guia correspondente em `node_modules/next/dist/docs/` antes de escrever código que use uma API do Next (proxy, cookies, server actions, fontes, rotas).
- Prisma 7: gerador `prisma-client` com `output`, `prisma.config.ts` e adaptador `@prisma/adapter-pg`. Consulte a documentação instalada antes de assumir a API do Prisma 5.
- TypeScript estrito (`strict`, `noUncheckedIndexedAccess`). Sem `any` e sem `@ts-ignore`.
- Tabelas e colunas em inglês `snake_case` (Prisma com `@map`/`@@map`, campos em `camelCase` no código). Chave primária UUID gerada pelo banco. Dinheiro em centavos inteiros. Instantes em `timestamptz`. Toda tabela com `created_at` e `updated_at`.
- Fora de `src/server/time/` é proibido: `new Date(<texto>)`, `Date.parse`, `getHours`, `getMinutes`, `getDay`, `getDate`, `getMonth`, `getFullYear`, `setHours`, `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`. `new Date()` (agora) e `new Date(<número>)` são permitidos.
- O cliente Prisma cru (`@/server/db/client`) só pode ser importado em `src/server/db/**`, `src/server/auth/**`, `src/server/domain/platform/**`, `prisma/**`, `scripts/**` e `tests/**`.
- Nenhum termo do sistema antigo no código novo: "Sans", "barbeiro", "barber", "Sans Coins", "clube_sans".
- Textos de interface em pt-BR, frase simples, voz ativa. Erro diz o que houve e como resolver.
- Toda tela funciona a 375 px de largura; campos de formulário com fonte de 16 px no celular; foco de teclado visível; respeita `prefers-reduced-motion`.
- Texturas só em CSS e SVG embutido. Nenhuma imagem de textura.
- Hosts vêm de variáveis de ambiente; nenhum domínio fixo no código.
- Não criar arquivos de documentação além dos que este plano lista.
- Commits locais ao fim de cada tarefa. Nunca `git push`.
- Não tocar em `_legacy/` depois da Tarefa 1, a não ser para ler.

## Review Focus

1. **E-mail de login com espaços ou maiúsculas** (`" Dono@Loja.com "`): deve entrar normalmente. Teste na Tarefa 6.
2. **Host inesperado** (maiúsculas, sem porta, IP direto, cabeçalho ausente): host conhecido é reconhecido sem diferenciar maiúsculas; qualquer outro responde 404, nunca cai num painel. Teste na Tarefa 7.
3. **Arquivo que não é imagem enviado como imagem** (texto renomeado para `.png`, SVG, imagem de dimensões gigantes): recusado com mensagem clara, nada gravado em disco. Teste na Tarefa 8.
4. **Cor de marca em formato solto** (`#abc`, `ABCDEF` sem `#`, branco puro, preto puro, amarelo vivo): normalizada quando possível, erro claro quando não; o texto sobre a cor continua legível. Teste na Tarefa 9.
5. **Banco local deixado sujo por uma queda** (`postmaster.pid` órfão em `.local/pg`, porta ocupada): `npm run dev` se recupera ou explica o que fazer em uma frase, sem pilha de erro crua. Teste na Tarefa 2.

---

## Mapa de arquivos

```
_legacy/                         código e docs antigos, só consulta (fora de build/lint/test)
prisma/schema.prisma             modelos da fundação
prisma/migrations/               SQL versionado
prisma/seed.ts                   admin + 2 contas de demonstração
prisma.config.ts
scripts/db.ts                    Postgres embutido (start/stop)
scripts/dev.ts                   banco + migrações + seed + next dev
scripts/admin-create.ts
src/proxy.ts                     roteamento por host
src/app/layout.tsx
src/app/dev/…                    painel dev (entrar, início, vitrine)
src/app/painel/…                 painel do negócio (entrar, escolher conta, início)
src/app/api/v1/health/route.ts
src/app/arquivos/[...key]/route.ts
src/server/env.ts
src/server/hosts.ts
src/server/db/client.ts          Prisma cru
src/server/db/tenant.ts          tenantDb
src/server/db/models.ts          TENANT_MODELS / GLOBAL_MODELS
src/server/time/index.ts         único lugar com fuso
src/server/auth/{password,tokens,rate-limit,actor,capabilities,platform-auth,member-auth,guards}.ts
src/server/storage/{storage,local-disk,images}.ts
src/ui/theme/{color,derive,fonts,ThemeScope}.ts(x)
src/ui/materials.css
src/ui/components/*.tsx
src/ui/shells/{PainelShell,DevShell}.tsx
tests/unit/**  tests/integration/**  tests/e2e/**  tests/setup/**
```

---

### Task 1: Projeto novo e ferramentas

**Files:**
- Move para `_legacy/`: `api-legacy/`, `src/`, `prisma/`, `tests/`, `scripts/`, `public/`, `package.json`, `package-lock.json`, `README.md`, `jsconfig.json`, `tailwind.config.js`, `next.config.mjs`, `vitest.config.mjs`, `eslint.config.mjs`, `postcss.config.mjs` e todos os `docs/*.md` (não mover `docs/superpowers/`)
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/server/env.ts`, `src/app/layout.tsx`, `src/app/globals.css`, `src/app/not-found.tsx`
- Modify: `AGENTS.md` (manter o bloco do Next intacto; substituir a parte "Sans Company")
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): Env` e `env: Env` (avaliado sob demanda) em `src/server/env.ts`, com
  `Env = { DATABASE_URL: string; APP_SECRET: string; DEV_HOST: string; PAINEL_HOST: string; API_HOST: string; STORAGE_DIR: string; NODE_ENV: 'development' | 'test' | 'production' }`.
  Padrões: `DEV_HOST=dev.localhost:3000`, `PAINEL_HOST=painel.localhost:3000`, `API_HOST=api.localhost:3000`, `STORAGE_DIR=.local/storage`. `APP_SECRET` exige 32+ caracteres.
- Produces: alias `@/*` → `src/*`; scripts npm `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`), `lint` (`eslint .`), `test` (`vitest run`), `test:tz`, `test:e2e`, `db:start`, `db:migrate`, `db:seed`, `db:reset`, `admin:create`. Nesta tarefa `dev` é `next dev -p 3000`; a Tarefa 12 troca por `tsx scripts/dev.ts`. Scripts que ainda não têm arquivo ficam para a tarefa que os cria.

- [ ] **Step 1:** (Já feito pelo coordenador: repositório git criado, itens movidos para `_legacy/`, que fica fora do git.) Conferir com `ls -A` que a raiz tem só `_legacy/`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`, `.git`, `.superpowers`.
- [ ] **Step 2:** Criar `package.json` (`"name": "agendaflui"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=22.18" }`) e instalar as dependências da Tech Stack, mais `pg`, `lucide-react`, `tsx`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `eslint@^9`, `eslint-config-next@16.3.3`, `@tailwindcss/postcss`. `.gitignore`: `_legacy`, `.superpowers`, `node_modules`, `.next`, `.local`, `.env`, `.env.local`, `src/server/db/generated`, `test-results`, `playwright-report`.
- [ ] **Step 3:** Ler em `node_modules/next/dist/docs/` os guias de instalação, estrutura de projeto e TypeScript. Criar `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `src/app/layout.tsx` (`<html lang="pt-BR">`), `globals.css` (só `@import "tailwindcss";`), `not-found.tsx` ("Página não encontrada").
- [ ] **Step 4:** `eslint.config.mjs`: base `eslint-config-next`; ignorar `_legacy/**`, `.local/**`, `src/server/db/generated/**`; regras das Global Constraints de data (`no-restricted-syntax`/`no-restricted-properties`, liberadas em `src/server/time/**` e `tests/**`) e de import do Prisma cru (`no-restricted-imports` com `overrides` para as pastas liberadas). `vitest.config.ts`: `include: ['tests/unit/**/*.test.ts?(x)', 'tests/integration/**/*.test.ts']`, `exclude` de `_legacy`, ambiente `node` (arquivos `.test.tsx` usam `// @vitest-environment jsdom`), alias `@`.
- [ ] **Step 5: Teste que falha** — `tests/unit/env.test.ts`:

```ts
const ok = { DATABASE_URL: 'postgres://u:p@localhost:5432/d', APP_SECRET: 'x'.repeat(32) }
test('aplica os padrões de host', () => {
  const env = parseEnv(ok)
  expect(env.DEV_HOST).toBe('dev.localhost:3000')
  expect(env.PAINEL_HOST).toBe('painel.localhost:3000')
  expect(env.API_HOST).toBe('api.localhost:3000')
  expect(env.STORAGE_DIR).toBe('.local/storage')
})
test('erro nomeia a variável que falta', () => {
  expect(() => parseEnv({ APP_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/)
})
test('recusa APP_SECRET curto', () => {
  expect(() => parseEnv({ ...ok, APP_SECRET: 'curto' })).toThrow(/APP_SECRET/)
})
```

- [ ] **Step 6:** Rodar `npx vitest run tests/unit/env.test.ts` → FALHA (módulo não existe). Implementar `src/server/env.ts` com Zod. Rodar de novo → PASSA.
- [ ] **Step 7:** `.env.example` com todas as variáveis de `Env` e valores de desenvolvimento (`DATABASE_URL=postgres://agendaflui:agendaflui@localhost:54329/agendaflui`), mais `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` de demonstração. Copiar para `.env`.
- [ ] **Step 8:** Reescrever a parte de projeto do `AGENTS.md` em até 25 linhas: o que é o AgendaFlui, os três hosts, "regra de negócio só em `src/server/`", "dados de conta só por `tenantDb`", "data e hora só por `src/server/time/`", comandos de verificação. Sem menção ao sistema antigo.
- [ ] **Step 9:** `npm run typecheck && npm run lint && npm test && npm run build` → tudo verde.
- [ ] **Step 10:** Commit: `chore: projeto novo do AgendaFlui, código antigo em _legacy`.

---

### Task 2: Banco local embutido e Prisma

**Files:**
- Create: `scripts/db.ts`, `prisma.config.ts`, `prisma/schema.prisma` (só `generator` e `datasource`), `src/server/db/client.ts`, `tests/setup/global-db.ts`, `tests/setup/db.ts`
- Modify: `vitest.config.ts` (`globalSetup`), `package.json` (scripts `db:*`)
- Test: `tests/integration/db.test.ts`, `tests/unit/db-script.test.ts`

**Interfaces:**
- Produces (`scripts/db.ts`): `startDb(opts: { dataDir: string; port: number; database: string }): Promise<{ url: string; stop(): Promise<void> }>`. Usuário e senha `agendaflui`. Cria o cluster e o banco se não existirem. Desenvolvimento: `.local/pg`, porta `54329`, banco `agendaflui`. Testes: `.local/pg-test`, porta `54330`, banco `agendaflui_test`.
- Produces: `describeStartFailure(err: unknown, port: number): string` — transforma falha de partida em uma frase em pt-BR.
- Produces (`src/server/db/client.ts`): `prisma` (singleton, `PrismaPg` com `env.DATABASE_URL`).
- Produces (`tests/setup/db.ts`): `resetDb(): Promise<void>` — `TRUNCATE … RESTART IDENTITY CASCADE` em todas as tabelas do schema `public`, exceto `_prisma_migrations`.

- [ ] **Step 1:** Ler o README de `embedded-postgres` em `node_modules` e a documentação do Prisma 7 sobre `prisma.config.ts` e adaptadores.
- [ ] **Step 2: Teste que falha** — `tests/unit/db-script.test.ts`:

```ts
test('porta ocupada vira frase clara', () => {
  const msg = describeStartFailure(Object.assign(new Error('x'), { code: 'EADDRINUSE' }), 54329)
  expect(msg).toContain('54329')
  expect(msg).toMatch(/já está em uso/)
})
test('erro desconhecido orienta a limpar o banco local', () => {
  expect(describeStartFailure(new Error('boom'), 54329)).toMatch(/npm run db:reset/)
})
```

- [ ] **Step 3:** Implementar `scripts/db.ts`. Antes de iniciar, se existir `postmaster.pid` no `dataDir` e o PID nele não estiver vivo (`process.kill(pid, 0)` lança), apagar o arquivo. `db:reset` apaga `.local/pg` e recria. Rodar o teste → PASSA.
- [ ] **Step 4:** `tests/setup/global-db.ts`: inicia o banco de teste, define `process.env.DATABASE_URL` e `APP_SECRET`, roda `prisma migrate deploy`, e para o banco no teardown.
- [ ] **Step 5: Teste que falha** — `tests/integration/db.test.ts`:

```ts
test('conecta no Postgres embutido', async () => {
  const rows = await prisma.$queryRaw<{ ok: number }[]>`select 1 as ok`
  expect(rows[0]?.ok).toBe(1)
})
test('extensões necessárias estão disponíveis', async () => {
  await prisma.$executeRawUnsafe('create extension if not exists btree_gist')
  await prisma.$executeRawUnsafe('create extension if not exists pgcrypto')
})
test('o servidor guarda instantes em UTC', async () => {
  const rows = await prisma.$queryRaw<{ t: Date }[]>`select '2026-11-13T12:00:00-03:00'::timestamptz as t`
  expect(rows[0]?.t.toISOString()).toBe('2026-11-13T15:00:00.000Z')
})
```

- [ ] **Step 6:** Implementar `client.ts` e `prisma.config.ts`; rodar `npx vitest run tests/integration/db.test.ts` → PASSA. **Se `btree_gist` não existir no binário embutido, pare e reporte BLOCKED com a mensagem de erro exata** (a fase 2 depende disso; a decisão é do coordenador).
- [ ] **Step 7:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: banco local embutido e cliente Prisma`.

---

### Task 3: Tabelas de base

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_foundation/migration.sql`, `src/server/db/models.ts`
- Test: `tests/integration/schema.test.ts`

**Interfaces:**
- Produces: modelos Prisma abaixo e `TENANT_MODELS`, `GLOBAL_MODELS` (`readonly string[]` com nomes de modelo) em `src/server/db/models.ts`.
  - Tenant (têm `business_id`): `Membership`, `BusinessBranding`, `BusinessModules`, `BusinessSettings`.
  - Global: `PlatformAdmin`, `PlatformSession`, `Business`, `User`, `Session`, `UserToken`, `Upload`, `AuditLog`.

Enums: `BusinessStatus { ACTIVE SUSPENDED ARCHIVED }`, `MembershipRole { OWNER MANAGER PROFESSIONAL }`, `CoverMaterial { LEATHER LINEN WOOD ENAMEL }`, `PaperTone { WHITE CREAM GRAY }`, `FontPair { CLASSIC MODERN FRIENDLY }`, `AuditActorType { PLATFORM_ADMIN USER SYSTEM }`, `UserTokenPurpose { INVITE PASSWORD_RESET }`.

| Tabela | Colunas (além de `id uuid`, `created_at`, `updated_at`) |
|---|---|
| `platform_admins` | `name`, `email` único, `password_hash`, `active bool = true`, `last_login_at?` |
| `platform_sessions` | `admin_id` → platform_admins (cascade), `token_hash` único, `expires_at`, `revoked_at?`, `ip?`, `user_agent?` |
| `businesses` | `slug` único, `name`, `segment?`, `document?`, `email?`, `phone?`, `address_line?`, `city?`, `state?`, `postal_code?`, `timezone = 'America/Sao_Paulo'`, `status BusinessStatus = ACTIVE`, `internal_notes?` |
| `business_branding` | PK `business_id` → businesses (cascade); `display_name`, `logo_upload_id?`, `symbol_upload_id?`, `favicon_upload_id?`, `login_image_upload_id?`, `login_message?`, `primary_color = '#0E4F5C'`, `accent_color = '#E0A030'`, `cover_material = ENAMEL`, `paper_tone = WHITE`, `font_pair = CLASSIC` |
| `business_modules` | PK `business_id`; `loyalty`, `banners`, `store`, `vouchers` (todos `bool = false`) |
| `business_settings` | PK `business_id`; `slot_step_min int = 15`, `min_lead_min int = 60`, `max_advance_days int = 60`, `customer_change_window_min int = 120`, `buffer_min int = 0`, `auto_confirm bool = true`, `term_professional_singular = 'Profissional'`, `term_professional_plural = 'Profissionais'`, `term_customer_singular = 'Cliente'`, `term_customer_plural = 'Clientes'`, `term_points_singular = 'Ponto'`, `term_points_plural = 'Pontos'`, `term_club = 'Clube'`, `loyalty_ranking_enabled bool = false`, `notifications jsonb = '{}'` |
| `users` | `name`, `email` único, `password_hash?` (nulo = convite pendente), `avatar_upload_id?`, `last_login_at?` |
| `memberships` | `business_id` → businesses (cascade), `user_id` → users (cascade), `role MembershipRole`, `active bool = true`; único `(business_id, user_id)` |
| `sessions` | `user_id?` → users, `impersonator_admin_id?` → platform_admins, `active_business_id?` → businesses, `token_hash` único, `expires_at`, `revoked_at?`, `ip?`, `user_agent?` |
| `user_tokens` | `user_id` → users (cascade), `purpose`, `token_hash` único, `expires_at`, `used_at?` |
| `uploads` | `business_id?` → businesses, `path` único, `mime_type`, `size_bytes int`, `width int`, `height int`, `created_by_type AuditActorType`, `created_by_id?` |
| `audit_logs` | `business_id?`, `actor_type`, `actor_id?`, `actor_name`, `on_behalf bool = false`, `action`, `target_type?`, `target_id?`, `metadata jsonb = '{}'`, `ip?`; índice `(business_id, created_at)`; **sem** `updated_at` |

Restrições em SQL puro no fim da migração:
- `businesses.slug` casa `^[a-z0-9]+(-[a-z0-9]+)*$` e tem de 3 a 40 caracteres;
- `business_modules`: `CHECK (NOT vouchers OR store)`;
- `sessions`: `CHECK ((user_id IS NULL) <> (impersonator_admin_id IS NULL))`;
- `business_branding.primary_color` e `accent_color` casam `^#[0-9A-F]{6}$`;
- `users.email`, `platform_admins.email`: `CHECK (email = lower(btrim(email)))`.

- [ ] **Step 1: Teste que falha** — `tests/integration/schema.test.ts` (usa `resetDb()` em `beforeEach`):

```ts
test('todo modelo está classificado como tenant ou global, sem repetição', () => {
  const all = Prisma.dmmf.datamodel.models.map((m) => m.name).sort()
  expect([...TENANT_MODELS, ...GLOBAL_MODELS].sort()).toEqual(all)
})
test('todo modelo tenant tem business_id obrigatório', () => {
  for (const name of TENANT_MODELS) {
    const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name)!
    const field = model.fields.find((f) => f.name === 'businessId')
    expect(field?.isRequired, name).toBe(true)
  }
})
test('slug inválido é recusado pelo banco', async () => {
  await expect(prisma.business.create({ data: { slug: 'Loja Errada', name: 'x' } })).rejects.toThrow()
})
test('vouchers sem loja é recusado pelo banco', async () => {
  const b = await prisma.business.create({ data: { slug: 'loja-um', name: 'Loja Um' } })
  await expect(
    prisma.businessModules.create({ data: { businessId: b.id, vouchers: true, store: false } }),
  ).rejects.toThrow()
})
test('e-mail com maiúsculas é recusado pelo banco', async () => {
  await expect(prisma.user.create({ data: { name: 'A', email: 'A@x.com' } })).rejects.toThrow()
})
test('sessão precisa de exatamente um dono', async () => {
  await expect(
    prisma.session.create({ data: { tokenHash: 'h', expiresAt: new Date(Date.now() + 1000) } }),
  ).rejects.toThrow()
})
```

- [ ] **Step 2:** Rodar → FALHA. Escrever o schema, gerar a migração com `prisma migrate dev --name foundation --create-only`, acrescentar as restrições em SQL, aplicar. Criar `models.ts`.
- [ ] **Step 3:** Rodar `npx vitest run tests/integration/schema.test.ts` → PASSA.
- [ ] **Step 4:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: tabelas de base da plataforma`.

---

### Task 4: Módulo de tempo

**Files:**
- Create: `src/server/time/index.ts`
- Modify: `package.json` (`"test:tz": "TZ=UTC vitest run tests/unit/time.test.ts && TZ=Asia/Tokyo vitest run tests/unit/time.test.ts && TZ=America/Sao_Paulo vitest run tests/unit/time.test.ts"`)
- Test: `tests/unit/time.test.ts`

**Interfaces:**
- Produces (tudo puro; instantes trafegam como `Date`, datas locais como `'YYYY-MM-DD'`, horas locais como `'HH:mm'`):

```ts
export type Weekday = 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY'
export function isValidTimeZone(tz: string): boolean
export function isLocalDate(s: string): boolean            // formato e data existente
export function isLocalTime(s: string): boolean            // 00:00–23:59
export function localDayRange(date: string, tz: string): { start: Date; end: Date } // end exclusivo
export function toInstant(date: string, time: string, tz: string): Date
export function localParts(instant: Date, tz: string): { date: string; time: string; weekday: Weekday }
export function weekdayOf(date: string): Weekday
export function todayIn(tz: string, now?: Date): string
export function addDays(date: string, days: number): string
export function minutesBetween(a: Date, b: Date): number
export function addMinutes(instant: Date, minutes: number): Date
export function formatDate(instant: Date, tz: string): string      // 'dd/MM/yyyy'
export function formatTime(instant: Date, tz: string): string      // 'HH:mm'
export function formatDateTime(instant: Date, tz: string): string  // 'dd/MM/yyyy HH:mm'
```

`toInstant` usa a regra `compatible` do Temporal: hora que não existe (início do horário de verão) avança para depois do salto; hora que se repete usa a primeira ocorrência. Entradas inválidas lançam `RangeError` com a entrada na mensagem.

- [ ] **Step 1: Teste que falha** — `tests/unit/time.test.ts`:

```ts
const iso = (d: Date) => d.toISOString()
test('dia local de São Paulo', () => {
  const r = localDayRange('2026-11-13', 'America/Sao_Paulo')
  expect(iso(r.start)).toBe('2026-11-13T03:00:00.000Z')
  expect(iso(r.end)).toBe('2026-11-14T03:00:00.000Z')
})
test('dia local de Manaus', () => {
  expect(iso(localDayRange('2026-11-13', 'America/Manaus').start)).toBe('2026-11-13T04:00:00.000Z')
})
test('dia de 25 horas em Lisboa (fim do horário de verão)', () => {
  const r = localDayRange('2026-10-25', 'Europe/Lisbon')
  expect(iso(r.start)).toBe('2026-10-24T23:00:00.000Z')
  expect(iso(r.end)).toBe('2026-10-26T00:00:00.000Z')
  expect(minutesBetween(r.start, r.end)).toBe(25 * 60)
})
test('hora que não existe em Nova York avança', () => {
  expect(iso(toInstant('2026-03-08', '02:30', 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z')
})
test('hora repetida em Nova York usa a primeira', () => {
  expect(iso(toInstant('2026-11-01', '01:30', 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z')
})
test('12:30 em São Paulo é 15:30 UTC', () => {
  expect(iso(toInstant('2026-11-13', '12:30', 'America/Sao_Paulo'))).toBe('2026-11-13T15:30:00.000Z')
})
test('virada de ano: partes locais', () => {
  expect(localParts(new Date('2026-01-01T02:30:00.000Z'), 'America/Sao_Paulo'))
    .toEqual({ date: '2025-12-31', time: '23:30', weekday: 'WEDNESDAY' })
})
test('dia da semana de data pura não depende de fuso', () => {
  expect(weekdayOf('2026-11-13')).toBe('FRIDAY')
})
test('hoje depende do fuso da conta', () => {
  const now = new Date('2026-11-14T01:00:00.000Z')
  expect(todayIn('America/Sao_Paulo', now)).toBe('2026-11-13')
  expect(todayIn('Europe/Lisbon', now)).toBe('2026-11-14')
})
test('addDays atravessa mês e ano', () => {
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
})
test('formatação', () => {
  const t = new Date('2026-11-13T15:00:00.000Z')
  expect(formatDateTime(t, 'America/Sao_Paulo')).toBe('13/11/2026 12:00')
  expect(formatDate(t, 'America/Sao_Paulo')).toBe('13/11/2026')
  expect(formatTime(t, 'America/Manaus')).toBe('11:00')
})
test('validações', () => {
  expect(isValidTimeZone('America/Sao_Paulo')).toBe(true)
  expect(isValidTimeZone('Marte/Olimpo')).toBe(false)
  expect(isLocalDate('2026-02-30')).toBe(false)
  expect(isLocalTime('24:00')).toBe(false)
  expect(() => toInstant('13/11/2026', '12:30', 'America/Sao_Paulo')).toThrow(RangeError)
})
```

- [ ] **Step 2:** Rodar → FALHA. Implementar com `temporal-polyfill` (`Temporal.PlainDate`, `PlainDateTime.toZonedDateTime(tz, { disambiguation: 'compatible' })`, `Instant.fromEpochMilliseconds`). Nenhum uso de métodos locais de `Date`.
- [ ] **Step 3:** `npx vitest run tests/unit/time.test.ts` → PASSA. `npm run test:tz` → PASSA nos três fusos.
- [ ] **Step 4:** Confirmar que o lint barra data fora do módulo: criar temporariamente `src/server/x.ts` com `new Date('2026-01-01').getHours()`, rodar `npm run lint` → ERRO; apagar o arquivo.
- [ ] **Step 5:** Commit: `feat: módulo único de data e fuso`.

---

### Task 5: Isolamento entre contas (`tenantDb`)

**Files:**
- Create: `src/server/db/tenant.ts`
- Test: `tests/integration/tenant.test.ts`, `tests/setup/factories.ts`

**Interfaces:**
- Consumes: `prisma`, `TENANT_MODELS`.
- Produces: `tenantDb(businessId: string): TenantClient` — cliente Prisma estendido (`$extends` com `query.$allModels.$allOperations`) que, para modelos em `TENANT_MODELS`: acrescenta `businessId` ao `where` de toda leitura, alteração e exclusão (inclusive `findUnique`, `update`, `delete`, `upsert`, `count`, `aggregate`, `groupBy`, `updateMany`, `deleteMany`); define `businessId` em `create`/`createMany`/`upsert.create`; lança `TenantViolationError` se o chamador passar um `businessId` diferente. Para modelos globais, não altera nada. `businessId` vazio ou que não é UUID lança na criação do cliente.
- Produces: `class TenantViolationError extends Error`.
- Produces (`tests/setup/factories.ts`): `makeBusiness(overrides?)` (cria `Business` + branding + modules + settings com slug único), `makeUser(overrides?)`, `makeMembership(businessId, userId, role)`.

- [ ] **Step 1: Teste que falha** — `tests/integration/tenant.test.ts`:

```ts
let a: Business, b: Business, ua: User, ub: User, ma: Membership, mb: Membership
beforeEach(async () => {
  await resetDb()
  ;[a, b] = [await makeBusiness(), await makeBusiness()]
  ;[ua, ub] = [await makeUser(), await makeUser()]
  ma = await makeMembership(a.id, ua.id, 'OWNER')
  mb = await makeMembership(b.id, ub.id, 'OWNER')
})
test('findMany só devolve dados da própria conta', async () => {
  expect((await tenantDb(a.id).membership.findMany()).map((m) => m.id)).toEqual([ma.id])
})
test('findUnique de registro de outra conta devolve null', async () => {
  expect(await tenantDb(a.id).membership.findUnique({ where: { id: mb.id } })).toBeNull()
})
test('update e delete de registro de outra conta falham e nada muda', async () => {
  await expect(tenantDb(a.id).membership.update({ where: { id: mb.id }, data: { active: false } })).rejects.toThrow()
  await expect(tenantDb(a.id).membership.delete({ where: { id: mb.id } })).rejects.toThrow()
  expect((await prisma.membership.findUniqueOrThrow({ where: { id: mb.id } })).active).toBe(true)
})
test('updateMany e deleteMany não vazam', async () => {
  expect((await tenantDb(a.id).membership.updateMany({ data: { active: false } })).count).toBe(1)
  expect((await tenantDb(a.id).membership.deleteMany({})).count).toBe(1)
  expect(await prisma.membership.count()).toBe(1)
})
test('count e groupBy são da conta', async () => {
  expect(await tenantDb(a.id).membership.count()).toBe(1)
  expect(await tenantDb(a.id).membership.groupBy({ by: ['role'], _count: true })).toHaveLength(1)
})
test('create grava na conta do cliente', async () => {
  const u = await makeUser()
  const m = await tenantDb(a.id).membership.create({ data: { userId: u.id, role: 'MANAGER' } as never })
  expect(m.businessId).toBe(a.id)
})
test('create apontando para outra conta é violação', async () => {
  const u = await makeUser()
  await expect(
    tenantDb(a.id).membership.create({ data: { businessId: b.id, userId: u.id, role: 'MANAGER' } }),
  ).rejects.toThrow(TenantViolationError)
})
test('tabelas chaveadas pela conta (marca) também são isoladas', async () => {
  expect(await tenantDb(a.id).businessBranding.findMany()).toHaveLength(1)
  await expect(
    tenantDb(a.id).businessBranding.update({ where: { businessId: b.id }, data: { displayName: 'x' } }),
  ).rejects.toThrow()
})
test('businessId inválido é recusado', () => {
  expect(() => tenantDb('')).toThrow()
  expect(() => tenantDb('não-é-uuid')).toThrow()
})
```

- [ ] **Step 2:** Rodar → FALHA. Implementar `tenant.ts` e as fábricas.
- [ ] **Step 3:** `npx vitest run tests/integration/tenant.test.ts` → PASSA.
- [ ] **Step 4:** Confirmar a regra de import: criar temporariamente `src/server/domain/x/y.ts` importando `@/server/db/client`, `npm run lint` → ERRO; apagar.
- [ ] **Step 5:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: acesso a dados isolado por conta`.

---

### Task 6: Acesso (senhas, sessões, papéis)

**Files:**
- Create: `src/server/auth/password.ts`, `tokens.ts`, `rate-limit.ts`, `actor.ts`, `capabilities.ts`, `platform-auth.ts`, `member-auth.ts`
- Test: `tests/unit/auth-basics.test.ts`, `tests/unit/capabilities.test.ts`, `tests/integration/auth.test.ts`

**Interfaces:**
- Produces:

```ts
// password.ts
export const passwordSchema: z.ZodString            // 10 a 200 caracteres
export function hashPassword(plain: string): Promise<string>   // argon2id
export function verifyPassword(hash: string, plain: string): Promise<boolean>
// tokens.ts
export function generateToken(): { token: string; hash: string }  // 32 bytes aleatórios, base64url
export function hashToken(token: string): string                  // sha256, base64url
// rate-limit.ts
export function createRateLimiter(o: { limit: number; windowMs: number; now?: () => number }):
  { check(key: string): { allowed: boolean; retryAfterMs: number }; reset(key: string): void }
// actor.ts
export type Actor =
  | { kind: 'platform_admin'; adminId: string; name: string }
  | { kind: 'member'; userId: string; name: string; role: MembershipRole }
  | { kind: 'impersonator'; adminId: string; name: string }
  | { kind: 'system' }
export type TenantContext = { businessId: string; timeZone: string; actor: Actor }
export class AuthError extends Error {
  code: 'invalid_credentials' | 'rate_limited' | 'account_inactive' | 'business_unavailable' | 'no_access'
}
// capabilities.ts
export const CAPABILITIES = ['view_dashboard','view_own_agenda','manage_own_availability','view_clients',
  'view_own_reports','view_all_agendas','view_all_reports','manage_clients','manage_team',
  'manage_catalog','manage_settings','manage_account'] as const
export type Capability = (typeof CAPABILITIES)[number]
export function can(actor: Actor, capability: Capability): boolean
// platform-auth.ts
export function loginPlatformAdmin(i: { email: string; password: string; ip?: string; userAgent?: string }):
  Promise<{ token: string; expiresAt: Date }>                    // 12 h
export function getPlatformActor(token: string | undefined): Promise<Extract<Actor, { kind: 'platform_admin' }> | null>
export function logoutPlatform(token: string): Promise<void>
// member-auth.ts
export type MemberSession = {
  user: { id: string; name: string; email: string }
  memberships: { businessId: string; businessName: string; slug: string; role: MembershipRole }[] // só ativos, em contas ACTIVE
  activeBusinessId: string | null
}
export function loginUser(i: { email: string; password: string; ip?: string; userAgent?: string }):
  Promise<{ token: string; expiresAt: Date; session: MemberSession }>   // 30 dias
export function getMemberSession(token: string | undefined): Promise<MemberSession | null>
export function selectBusiness(token: string, businessId: string): Promise<void>  // AuthError('no_access') se não for membro ativo
export function getTenantContext(token: string | undefined): Promise<TenantContext | null>
export function logoutUser(token: string): Promise<void>
```

Regras: `can` — `PROFESSIONAL` tem só as 5 primeiras capacidades; `MANAGER` tem todas menos `manage_account`; `OWNER` e `impersonator` têm todas; `platform_admin` e `system` não têm nenhuma capacidade de conta. Login normaliza o e-mail com `trim().toLowerCase()`. E-mail inexistente e senha errada dão o mesmo `invalid_credentials` (verificando contra um hash fixo para igualar o tempo). Limite: 5 tentativas por 15 min por e-mail. Se o usuário tem exatamente uma conta disponível, `loginUser` já a define como ativa. Sessão revogada ou vencida equivale a `null`. Usuário com `password_hash` nulo não entra.

- [ ] **Step 1: Testes que falham** — `tests/unit/capabilities.test.ts`:

```ts
const member = (role: MembershipRole): Actor => ({ kind: 'member', userId: 'u', name: 'n', role })
test('profissional só tem o básico', () => {
  const allowed = CAPABILITIES.filter((c) => can(member('PROFESSIONAL'), c))
  expect(allowed).toEqual(['view_dashboard','view_own_agenda','manage_own_availability','view_clients','view_own_reports'])
})
test('gerente tem tudo menos a conta', () => {
  expect(CAPABILITIES.filter((c) => !can(member('MANAGER'), c))).toEqual(['manage_account'])
})
test('dono e suporte têm tudo', () => {
  expect(CAPABILITIES.every((c) => can(member('OWNER'), c))).toBe(true)
  expect(CAPABILITIES.every((c) => can({ kind: 'impersonator', adminId: 'a', name: 'n' }, c))).toBe(true)
})
test('admin da plataforma fora de uma conta não tem capacidade de conta', () => {
  expect(CAPABILITIES.some((c) => can({ kind: 'platform_admin', adminId: 'a', name: 'n' }, c))).toBe(false)
})
```

`tests/unit/auth-basics.test.ts`: `verifyPassword(await hashPassword('senha-bem-longa'), 'senha-bem-longa')` é `true` e com outra senha é `false`; o hash começa com `$argon2id$`; `passwordSchema` recusa 9 caracteres; `generateToken()` devolve `hash === hashToken(token)` e dois tokens seguidos são diferentes; limitador com `limit: 2, windowMs: 1000` e relógio falso: 3ª chamada `allowed: false` com `retryAfterMs > 0`, e volta a permitir depois de 1000 ms.

`tests/integration/auth.test.ts` (com `resetDb()`):

```ts
test('admin da plataforma entra e a sessão vale', async () => {
  await makePlatformAdmin({ email: 'dev@agendaflui.test', password: 'senha-bem-longa' })
  const { token } = await loginPlatformAdmin({ email: 'dev@agendaflui.test', password: 'senha-bem-longa' })
  expect((await getPlatformActor(token))?.kind).toBe('platform_admin')
  await logoutPlatform(token)
  expect(await getPlatformActor(token)).toBeNull()
})
test('e-mail com espaços e maiúsculas entra', async () => {
  const u = await makeUser({ email: 'dono@loja.test', password: 'senha-bem-longa' })
  const b = await makeBusiness(); await makeMembership(b.id, u.id, 'OWNER')
  const r = await loginUser({ email: '  Dono@Loja.Test ', password: 'senha-bem-longa' })
  expect(r.session.activeBusinessId).toBe(b.id)
})
test('senha errada e e-mail inexistente dão o mesmo erro', async () => {
  await makeUser({ email: 'a@x.test', password: 'senha-bem-longa' })
  await expect(loginUser({ email: 'a@x.test', password: 'errada-errada' })).rejects.toMatchObject({ code: 'invalid_credentials' })
  await expect(loginUser({ email: 'nao@x.test', password: 'errada-errada' })).rejects.toMatchObject({ code: 'invalid_credentials' })
})
test('sexta tentativa em 15 minutos é barrada', async () => {
  for (let i = 0; i < 5; i++) await loginUser({ email: 'z@x.test', password: 'errada-errada' }).catch(() => {})
  await expect(loginUser({ email: 'z@x.test', password: 'errada-errada' })).rejects.toMatchObject({ code: 'rate_limited' })
})
test('quem tem duas contas escolhe; conta suspensa não aparece', async () => {
  const u = await makeUser({ password: 'senha-bem-longa' })
  const [b1, b2, b3] = [await makeBusiness(), await makeBusiness(), await makeBusiness({ status: 'SUSPENDED' })]
  for (const b of [b1, b2, b3]) await makeMembership(b.id, u.id, 'OWNER')
  const { token, session } = await loginUser({ email: u.email, password: 'senha-bem-longa' })
  expect(session.activeBusinessId).toBeNull()
  expect(session.memberships.map((m) => m.businessId).sort()).toEqual([b1.id, b2.id].sort())
  await expect(selectBusiness(token, b3.id)).rejects.toMatchObject({ code: 'no_access' })
  await selectBusiness(token, b2.id)
  const ctx = await getTenantContext(token)
  expect(ctx).toMatchObject({ businessId: b2.id, timeZone: b2.timezone, actor: { kind: 'member', role: 'OWNER' } })
})
test('convite pendente (sem senha) não entra', async () => {
  const u = await makeUser({ password: null })
  await expect(loginUser({ email: u.email, password: 'qualquer-coisa' })).rejects.toMatchObject({ code: 'invalid_credentials' })
})
test('membro desativado perde o acesso na hora', async () => {
  const u = await makeUser({ password: 'senha-bem-longa' }); const b = await makeBusiness()
  const m = await makeMembership(b.id, u.id, 'MANAGER')
  const { token } = await loginUser({ email: u.email, password: 'senha-bem-longa' })
  await prisma.membership.update({ where: { id: m.id }, data: { active: false } })
  expect(await getTenantContext(token)).toBeNull()
})
```

- [ ] **Step 2:** Estender `tests/setup/factories.ts`: `makeUser` aceita `password` (texto, vira hash; `null` = sem senha; padrão `'senha-bem-longa'`), `makePlatformAdmin({ email?, password? })`, `makeBusiness({ status?, timezone? })`. O limitador de login deve ser reiniciável nos testes (`resetLoginLimiter()` exportado de `member-auth.ts` e `platform-auth.ts`).
- [ ] **Step 3:** Rodar → FALHA. Implementar os sete arquivos.
- [ ] **Step 4:** `npx vitest run tests/unit/auth-basics.test.ts tests/unit/capabilities.test.ts tests/integration/auth.test.ts` → PASSA.
- [ ] **Step 5:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: acesso com sessões, papéis e limite de tentativas`.

---

### Task 7: Roteamento por host

**Files:**
- Create: `src/server/hosts.ts`, `src/proxy.ts`, `src/app/api/v1/health/route.ts`, `src/app/dev/page.tsx`, `src/app/painel/page.tsx` (os dois últimos provisórios, um parágrafo cada)
- Test: `tests/unit/hosts.test.ts`

**Interfaces:**
- Consumes: `env.DEV_HOST`, `env.PAINEL_HOST`, `env.API_HOST`.
- Produces:

```ts
export type Area = 'dev' | 'painel' | 'api'
export type HostConfig = { dev: string; painel: string; api: string }
export function resolveArea(host: string | null | undefined, cfg: HostConfig): Area | null
export function routeRequest(host: string | null | undefined, pathname: string, cfg: HostConfig):
  { action: 'rewrite'; to: string } | { action: 'pass' } | { action: 'not_found' }
export function areaUrl(area: Area, path: string, cfg: HostConfig, protocol: 'http' | 'https'): string
```

Regras de `routeRequest`: caminhos `/_next/*`, `/arquivos/*` e `/favicon.ico` → `pass` em qualquer host conhecido; host desconhecido → `not_found`; caminho de entrada que já começa com `/dev`, `/painel` ou `/api` (segmento exato) → `not_found`; senão `rewrite` para `/dev{path}`, `/painel{path}` ou `/api{path}`. Comparação de host sem diferenciar maiúsculas e ignorando ponto final.

- [ ] **Step 1: Teste que falha** — `tests/unit/hosts.test.ts`:

```ts
const cfg = { dev: 'dev.localhost:3000', painel: 'painel.localhost:3000', api: 'api.localhost:3000' }
test('reconhece os três hosts sem diferenciar maiúsculas', () => {
  expect(resolveArea('DEV.localhost:3000', cfg)).toBe('dev')
  expect(resolveArea('painel.localhost:3000', cfg)).toBe('painel')
  expect(resolveArea('api.localhost:3000.', cfg)).toBe('api')
})
test('host desconhecido, vazio ou ausente não é área nenhuma', () => {
  for (const h of ['localhost:3000', '127.0.0.1:3000', 'evil.com', 'dev.localhost', '', null, undefined])
    expect(resolveArea(h, cfg)).toBeNull()
})
test('reescreve para a área do host', () => {
  expect(routeRequest('dev.localhost:3000', '/contas', cfg)).toEqual({ action: 'rewrite', to: '/dev/contas' })
  expect(routeRequest('painel.localhost:3000', '/', cfg)).toEqual({ action: 'rewrite', to: '/painel' })
  expect(routeRequest('api.localhost:3000', '/v1/health', cfg)).toEqual({ action: 'rewrite', to: '/api/v1/health' })
})
test('um host não alcança a área de outro', () => {
  expect(routeRequest('painel.localhost:3000', '/dev/contas', cfg)).toEqual({ action: 'not_found' })
  expect(routeRequest('dev.localhost:3000', '/painel', cfg)).toEqual({ action: 'not_found' })
  expect(routeRequest('painel.localhost:3000', '/api/v1/health', cfg)).toEqual({ action: 'not_found' })
})
test('caminho parecido com prefixo interno não é barrado', () => {
  expect(routeRequest('painel.localhost:3000', '/devolucoes', cfg)).toEqual({ action: 'rewrite', to: '/painel/devolucoes' })
})
test('host desconhecido é 404; estáticos passam em host conhecido', () => {
  expect(routeRequest('localhost:3000', '/', cfg)).toEqual({ action: 'not_found' })
  expect(routeRequest('dev.localhost:3000', '/_next/static/x.js', cfg)).toEqual({ action: 'pass' })
  expect(routeRequest('painel.localhost:3000', '/arquivos/a/b.webp', cfg)).toEqual({ action: 'pass' })
})
```

- [ ] **Step 2:** Rodar → FALHA. Implementar `hosts.ts`. Rodar → PASSA.
- [ ] **Step 3:** Ler o guia de `proxy` em `node_modules/next/dist/docs/`. Implementar `src/proxy.ts` chamando `routeRequest` (404 = reescrever para uma rota inexistente que cai no `not-found.tsx`, com status 404). `GET /api/v1/health` responde `{ "status": "ok" }`.
- [ ] **Step 4:** Verificação manual com o servidor de pé (`npm run dev`, que nesta altura é só o Next; a rota de saúde não usa banco): `curl -s -o /dev/null -w '%{http_code}' -H 'Host: api.localhost:3000' http://127.0.0.1:3000/v1/health` → `200`; com `-H 'Host: painel.localhost:3000'` no mesmo caminho → `404`; `-H 'Host: localhost:3000' http://127.0.0.1:3000/` → `404`.
- [ ] **Step 5:** `npm run typecheck && npm run lint && npm test && npm run build` → verde. Commit: `feat: três hosts roteados por proxy`.

---

### Task 8: Arquivos e imagens

**Files:**
- Create: `src/server/storage/storage.ts`, `local-disk.ts`, `images.ts`, `src/app/arquivos/[...key]/route.ts`
- Test: `tests/integration/storage.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>
  delete(key: string): Promise<void>
}
export function createLocalDiskStorage(rootDir: string): Storage   // chave com '..', barra inicial ou byte nulo → lança
export function getStorage(): Storage                              // usa env.STORAGE_DIR
export type ImagePurpose = 'logo' | 'symbol' | 'favicon' | 'login' | 'avatar' | 'generic'
export class ImageError extends Error { code: 'too_large' | 'not_an_image' | 'unsupported_format' | 'too_many_pixels' }
export function saveImage(i: { businessId: string | null; data: Buffer; purpose: ImagePurpose;
  createdBy: { type: AuditActorType; id: string | null } }, storage?: Storage): Promise<Upload>
export function uploadUrl(upload: { path: string } | null | undefined): string | null   // '/arquivos/' + path
```

Regras de `saveImage`: entrada até 8 MB; aceita JPEG, PNG e WebP (decidido pelo conteúdo via `sharp`, nunca pela extensão; SVG e GIF são `unsupported_format`); limite de 40 megapixels (`limitInputPixels`); remove metadados; aplica a orientação EXIF; redimensiona sem ampliar para caber em `logo` 800×400, `symbol` 512×512 (corte central), `favicon` 96×96 (corte central, PNG), `login` 2000×2000, `avatar` 512×512 (corte central), `generic` 1600×1600; grava WebP qualidade 85 (exceto favicon). Chave: `{businessId ?? 'platform'}/{uuid}.{ext}`. A rota `/arquivos/[...key]` devolve o arquivo com `Cache-Control: public, max-age=31536000, immutable`, ou 404.

- [ ] **Step 1: Teste que falha** — `tests/integration/storage.test.ts` (storage em diretório temporário; imagens geradas com `sharp({ create: … })`):

```ts
test('grava logo como webp dentro do limite', async () => {
  const up = await saveImage({ businessId: biz.id, data: await png(2400, 1200), purpose: 'logo', createdBy }, storage)
  expect(up.mimeType).toBe('image/webp')
  expect(up.width).toBe(800); expect(up.height).toBe(400)
  expect(up.path.startsWith(`${biz.id}/`)).toBe(true)
  expect(await storage.get(up.path)).not.toBeNull()
})
test('não amplia imagem pequena', async () => {
  const up = await saveImage({ businessId: biz.id, data: await png(100, 50), purpose: 'logo', createdBy }, storage)
  expect([up.width, up.height]).toEqual([100, 50])
})
test('símbolo vira quadrado', async () => {
  const up = await saveImage({ businessId: biz.id, data: await png(900, 600), purpose: 'symbol', createdBy }, storage)
  expect([up.width, up.height]).toEqual([512, 512])
})
test('texto disfarçado de imagem é recusado e nada é gravado', async () => {
  await expect(saveImage({ businessId: biz.id, data: Buffer.from('não sou imagem'), purpose: 'logo', createdBy }, storage))
    .rejects.toMatchObject({ code: 'not_an_image' })
  expect(await prisma.upload.count()).toBe(0)
})
test('SVG é recusado', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  await expect(saveImage({ businessId: biz.id, data: svg, purpose: 'logo', createdBy }, storage))
    .rejects.toMatchObject({ code: 'unsupported_format' })
})
test('arquivo acima de 8 MB é recusado', async () => {
  await expect(saveImage({ businessId: biz.id, data: Buffer.alloc(8 * 1024 * 1024 + 1), purpose: 'logo', createdBy }, storage))
    .rejects.toMatchObject({ code: 'too_large' })
})
test('chave com .. é recusada pelo disco', async () => {
  await expect(storage.get('../../etc/passwd')).rejects.toThrow()
  await expect(storage.put('a/../../x', Buffer.from('x'), 'text/plain')).rejects.toThrow()
})
test('upload da plataforma usa a pasta platform', async () => {
  const up = await saveImage({ businessId: null, data: await png(64, 64), purpose: 'generic', createdBy }, storage)
  expect(up.path.startsWith('platform/')).toBe(true)
})
```

- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: armazenamento de imagens validado`.

---

### Task 9: Motor de tema por marca

**Files:**
- Create: `src/ui/theme/color.ts`, `derive.ts`, `fonts.ts`, `ThemeScope.tsx`, `src/ui/theme/default-brand.ts`
- Test: `tests/unit/theme.test.ts`

**Interfaces:**
- Produces:

```ts
// color.ts
export function normalizeHex(input: string): string   // '#abc' | 'abc' | 'AABBCC' | '#aabbcc' → '#AABBCC'; inválido → RangeError
export function contrastRatio(a: string, b: string): number   // WCAG 2.x
// derive.ts
export type BrandInput = { primary: string; accent: string; material: CoverMaterial; paper: PaperTone; fontPair: FontPair }
export type ThemeTokens = {
  vars: Record<
    '--cover' | '--cover-hi' | '--cover-lo' | '--cover-deep' | '--on-cover' | '--on-cover-soft' |
    '--accent' | '--accent-hi' | '--accent-lo' | '--on-accent' | '--accent-ink' |
    '--paper' | '--paper-edge' | '--paper-line' | '--paper-sunk' | '--ink' | '--ink-soft' | '--ink-faint' |
    '--ok' | '--warn' | '--bad', string>
  material: 'leather' | 'linen' | 'wood' | 'enamel'
  fontPair: 'classic' | 'modern' | 'friendly'
  warnings: string[]
}
export function deriveTheme(input: BrandInput): ThemeTokens
export const PAPER: Record<PaperTone, string>   // WHITE '#FBFAF7', CREAM '#F6EFDD', GRAY '#ECEEF0'
// default-brand.ts
export const AGENDAFLUI_BRAND: BrandInput        // primary '#0E4F5C', accent '#E0A030', ENAMEL, WHITE, CLASSIC
// ThemeScope.tsx
export function ThemeScope(p: { theme: ThemeTokens; children: React.ReactNode; className?: string }): JSX.Element
// fonts.ts — next/font: Hanken Grotesk (texto), Barlow Condensed (carimbo) e os títulos de cada par
export const fontVariables: string   // classes para o <html>
```

Regras de `deriveTheme`: trabalhar em OKLCH. `--cover` é a cor principal; `--cover-hi`/`--cover-lo`/`--cover-deep` são a mesma matiz com luminosidade +8, −8 e −18 pontos (limitadas a 0–100), usadas em realce, sombra e costura. `--on-cover` é branco (`#FFFFFF`) ou tinta (`#1B1A17`), o que der mais contraste; se o melhor ficar abaixo de 4.5, escurecer `--cover` em passos de 2 pontos até o branco atingir 4.5 e registrar em `warnings`: `"A cor principal foi escurecida para o texto ficar legível."`. O mesmo para `--accent`/`--on-accent`. `--accent-ink` é o destaque ajustado (escurecido) até ter 4.5 contra o papel escolhido; é a única forma de usar a cor da marca como texto sobre papel. `--ink` é `#1B1A17`; `--ink-soft` e `--ink-faint` têm no mínimo 4.5 e 3.0 contra o papel. `--ok`, `--warn`, `--bad` são fixos e têm 4.5 contra os três papéis. Pares de fonte: `CLASSIC` Zilla Slab, `MODERN` Schibsted Grotesk, `FRIENDLY` Fredoka (títulos); texto sempre Hanken Grotesk. `ThemeScope` aplica `vars` em `style` e `data-material`, `data-font` num `<div>`; pode ser aninhado (prévia dentro do painel dev).

- [ ] **Step 1: Teste que falha** — `tests/unit/theme.test.ts`:

```ts
const base = { accent: '#E0A030', material: 'LEATHER', paper: 'WHITE', fontPair: 'CLASSIC' } as const
const COLORS = ['#0E4F5C','#7A1F2B','#FFFF00','#FFFFFF','#000000','#808080','#FF6600','#2F6B4F','#C9A227','#E91E63','#3F51B5','#9E9E9E']
test('normaliza formatos soltos', () => {
  expect(normalizeHex('#abc')).toBe('#AABBCC')
  expect(normalizeHex('aabbcc')).toBe('#AABBCC')
  expect(normalizeHex(' #AaBbCc ')).toBe('#AABBCC')
})
test('recusa o que não é cor', () => {
  for (const bad of ['', '#12', 'vermelho', '#GGGGGG', '#1234567']) expect(() => normalizeHex(bad)).toThrow(RangeError)
})
test('contraste conhecido', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0)
  expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1)
})
test.each(COLORS)('texto sobre a capa é legível com %s', (primary) => {
  const t = deriveTheme({ ...base, primary })
  expect(contrastRatio(t.vars['--on-cover'], t.vars['--cover'])).toBeGreaterThanOrEqual(4.5)
})
test.each(COLORS)('destaque %s é legível como texto nos três papéis', (accent) => {
  for (const paper of ['WHITE', 'CREAM', 'GRAY'] as const) {
    const t = deriveTheme({ ...base, primary: '#0E4F5C', accent, paper })
    expect(contrastRatio(t.vars['--accent-ink'], t.vars['--paper'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.vars['--on-accent'], t.vars['--accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.vars['--ink-soft'], t.vars['--paper'])).toBeGreaterThanOrEqual(4.5)
  }
})
test('cor que precisou de ajuste gera aviso; cor boa não', () => {
  expect(deriveTheme({ ...base, primary: '#808080' }).warnings.length).toBeGreaterThan(0)
  expect(deriveTheme({ ...base, primary: '#0E4F5C' }).warnings).toEqual([])
})
test('material e par de fontes viram atributos', () => {
  const t = deriveTheme({ ...base, primary: '#0E4F5C', material: 'LINEN', fontPair: 'FRIENDLY' })
  expect([t.material, t.fontPair]).toEqual(['linen', 'friendly'])
})
test('cores de situação são legíveis em todo papel', () => {
  for (const paper of ['WHITE', 'CREAM', 'GRAY'] as const) {
    const t = deriveTheme({ ...base, primary: '#0E4F5C', paper })
    for (const k of ['--ok', '--warn', '--bad'] as const)
      expect(contrastRatio(t.vars[k], t.vars['--paper'])).toBeGreaterThanOrEqual(4.5)
  }
})
```

- [ ] **Step 2:** Rodar → FALHA. Implementar (conversão sRGB↔OKLCH escrita à mão em `color.ts`, sem biblioteca). Rodar → PASSA.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: tema derivado da marca com contraste garantido`.

---

### Task 10: Componentes skeuomórficos

**Files:**
- Create: `src/ui/materials.css`, `src/ui/components/{Button,Field,Input,Textarea,Select,Switch,Checkbox,Paper,Stamp,Counter,Lamp,Gauge,Tabs,Dialog,Toast,Avatar,EmptyState,Skeleton,DataList}.tsx`, `src/ui/components/index.ts`
- Modify: `src/app/globals.css` (importa `materials.css`, define a base tipográfica e os utilitários de relevo)
- Test: `tests/unit/ui/{Button,Switch,Dialog,DataList,Counter}.test.tsx`

**Antes de escrever:** leia a seção 11 da spec inteira. Se a skill `frontend-design:frontend-design` estiver disponível, invoque-a. O conceito é fixo: **agenda de balcão** (capa no material e cor da marca, conteúdo em papel) e **mesa de controle** (metal anodizado) para o painel dev. Cada objeto imita algo que já tem aquela função num balcão. A luz vem sempre de cima à esquerda. Ousadia concentrada: as fichas, os carimbos e os contadores; o resto é contido.

**Interfaces:**
- Consumes: variáveis CSS de `ThemeTokens['vars']`, `data-material`, `data-font`.
- Produces (todos aceitam `className`; os de formulário repassam props nativas e `ref`):

| Componente | Props próprias | Objeto imitado e comportamento |
|---|---|---|
| `Button` | `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger'`, `size: 'sm' \| 'md' \| 'lg'`, `loading?`, `icon?` | Tecla com curso: sombra inferior some e a tecla desce 2 px em `:active`. `primary` usa `--accent`/`--on-accent`. `loading` desabilita e mostra "Aguarde…" para leitores de tela. |
| `Field` | `label`, `hint?`, `error?`, `children` | Liga rótulo, dica e erro ao campo por `id`/`aria-describedby`. Erro em `--bad` com ícone. |
| `Input`, `Textarea`, `Select` | nativas + `invalid?` | Rebaixados no papel (sombra interna, `--paper-sunk`). 16 px no celular. |
| `Switch` | `checked`, `onCheckedChange`, `label` | Chave liga/desliga física; `role="switch"`, Espaço e Enter alternam. |
| `Checkbox` | nativas + `label` | Caixa marcada a caneta. |
| `Paper` | `as?`, `lined?`, `raised?: 0 \| 1 \| 2` | Folha: `--paper`, borda `--paper-edge`, pauta opcional `--paper-line`. |
| `Stamp` | `tone: 'ok' \| 'warn' \| 'bad' \| 'neutral'`, `children` | Carimbo: Barlow Condensed, contorno duplo, tinta irregular por máscara SVG, girado −4°. |
| `Counter` | `value: number`, `digits?: number`, `label`, `format?: 'int' \| 'brl'` | Contador mecânico, um tambor por dígito. Leitor de tela lê o valor formatado, não os dígitos. |
| `Lamp` | `state: 'on' \| 'warn' \| 'error' \| 'off'`, `label` | Lâmpada-piloto; o estado também está no texto, nunca só na cor. |
| `Gauge` | `value: number` (0–1), `label`, `display: string` | Medidor analógico em SVG; `role="meter"`. |
| `Tabs` | `items: { id; label; href? }[]`, `value`, `onChange?` | Divisórias de fichário; setas navegam; `role="tablist"`. |
| `Dialog` | `open`, `onClose`, `title`, `footer?`, `children` | `<dialog>` nativo. ≥640 px: folha centralizada. <640 px: folha que sobe da base, cabeçalho e rodapé fixos, conteúdo rola, `dvh` e área segura. Esc e clique fora fecham; foco volta ao gatilho. |
| `Toast` + `useToast()` | `toast({ tone, message })` | Bilhete que entra no canto; `role="status"`. |
| `Avatar` | `src?`, `name`, `size` | Foto em moldura; sem foto, iniciais. |
| `EmptyState` | `title`, `description?`, `action?` | Página em branco com convite à ação. |
| `Skeleton` | `lines?`, `className` | Linhas a lápis; sem animação em `prefers-reduced-motion`. |
| `DataList<T>` | `columns: { key; header; cell(row); primary? }[]`, `rows`, `rowKey`, `onRowClick?`, `empty` | ≥768 px: tabela em papel pautado. Abaixo: lista de cartões, coluna `primary` como título. |

`materials.css`: `[data-material="leather" | "linen" | "wood" | "enamel"]` para a capa e `.material-metal` para o painel dev, cada um com textura em gradientes e ruído SVG embutido sobre `--cover`, mais os utilitários `.raised`, `.sunk`, `.stitched`, `.engraved`.

- [ ] **Step 1: Testes que falham** (`// @vitest-environment jsdom`, Testing Library + user-event):

```tsx
// Button.test.tsx
test('loading desabilita e avisa', async () => {
  const onClick = vi.fn()
  render(<Button loading onClick={onClick}>Salvar</Button>)
  await userEvent.click(screen.getByRole('button'))
  expect(onClick).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
})
// Switch.test.tsx
test('alterna com teclado e expõe o estado', async () => {
  const onChange = vi.fn()
  render(<Switch checked={false} onCheckedChange={onChange} label="Lembretes" />)
  const sw = screen.getByRole('switch', { name: 'Lembretes' })
  expect(sw).toHaveAttribute('aria-checked', 'false')
  sw.focus(); await userEvent.keyboard(' ')
  expect(onChange).toHaveBeenCalledWith(true)
})
// Dialog.test.tsx
test('Esc fecha e o título nomeia o diálogo', async () => {
  const onClose = vi.fn()
  render(<Dialog open onClose={onClose} title="Novo agendamento">conteúdo</Dialog>)
  expect(screen.getByRole('dialog', { name: 'Novo agendamento' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})
// DataList.test.tsx
test('lista vazia mostra o convite', () => {
  render(<DataList columns={[{ key: 'n', header: 'Nome', cell: (r: { n: string }) => r.n, primary: true }]}
    rows={[]} rowKey={(r) => r.n} empty={<EmptyState title="Nenhum cliente ainda" />} />)
  expect(screen.getByText('Nenhum cliente ainda')).toBeInTheDocument()
})
test('linha clicável responde ao Enter', async () => {
  const onRowClick = vi.fn()
  render(<DataList columns={[{ key: 'n', header: 'Nome', cell: (r: { n: string }) => r.n, primary: true }]}
    rows={[{ n: 'Ana' }]} rowKey={(r) => r.n} onRowClick={onRowClick} empty={null} />)
  screen.getAllByText('Ana')[0]!.closest('[tabindex]')!.focus(); await userEvent.keyboard('{Enter}')
  expect(onRowClick).toHaveBeenCalledWith({ n: 'Ana' })
})
// Counter.test.tsx
test('leitor de tela lê o valor formatado', () => {
  render(<Counter value={123450} format="brl" label="Faturamento do mês" />)
  expect(screen.getByLabelText('Faturamento do mês')).toHaveTextContent('R$ 1.234,50')
})
```

(`jsdom` não implementa `showModal`; o teste do `Dialog` precisa de um polyfill mínimo em `tests/setup/dom.ts`.)

- [ ] **Step 2:** Rodar → FALHA. Implementar materiais e componentes.
- [ ] **Step 3:** `npx vitest run tests/unit/ui` → PASSA. `npm run typecheck && npm run lint && npm run build` → verde.
- [ ] **Step 4:** Commit: `feat: design system skeuomórfico`.

---

### Task 11: Molduras dos painéis e vitrine

**Files:**
- Create: `src/ui/shells/PainelShell.tsx`, `src/ui/shells/DevShell.tsx`, `src/ui/shells/BrandMark.tsx`, `src/app/dev/vitrine/page.tsx`, `src/app/dev/vitrine/Showcase.tsx`
- Modify: `src/app/layout.tsx` (aplica `fontVariables`)
- Test: `tests/e2e/vitrine.spec.ts`, `playwright.config.ts`

**Interfaces:**
- Consumes: componentes da Tarefa 10, `deriveTheme`, `ThemeScope`, `AGENDAFLUI_BRAND`.
- Produces:

```ts
export type NavItem = { href: string; label: string; icon: LucideIcon; active?: boolean }
export function PainelShell(p: {
  theme: ThemeTokens; brand: { name: string; logoUrl: string | null; symbolUrl: string | null }
  nav: NavItem[]; user: { name: string; roleLabel: string; avatarUrl: string | null }
  supportBanner?: string        // "Você está no painel de X como suporte" — faixa permanente
  title: string; actions?: React.ReactNode; children: React.ReactNode
}): JSX.Element
export function DevShell(p: { nav: NavItem[]; admin: { name: string }; title: string;
  actions?: React.ReactNode; children: React.ReactNode }): JSX.Element
export function BrandMark(p: { name: string; logoUrl: string | null; size: 'sm' | 'md' | 'lg' }): JSX.Element
```

`PainelShell`: no computador, capa à esquerda (material e cor da marca, logo em baixo-relevo; sem logo, o nome em `--font-display`), divisórias de fichário como menu (a ativa encosta no papel), conteúdo numa folha. Abaixo de 768 px: a capa vira uma barra superior com a marca e o título da página, e o menu vira uma barra de divisórias fixa na base (até 5 itens; os demais em "Mais", que abre uma folha). `DevShell`: mesma estrutura em `.material-metal`, sempre com a marca AgendaFlui.

`/vitrine` (host `dev.`, sem login nesta fase): à esquerda, um formulário de marca (cor principal, destaque, material, papel, par de fontes, nome) com os avisos de contraste de `deriveTheme`; à direita, um `PainelShell` de demonstração dentro de `ThemeScope` que muda ao vivo, contendo todos os componentes da Tarefa 10 em uso realista: uma página de agenda do dia com 4 fichas (`Paper` + `Stamp`), 3 contadores, uma `DataList` de clientes, um formulário, botões em todos os estados, um `Dialog`. Abaixo, uma seção "Mesa de controle" com `DevShell`, `Gauge` e `Lamp`. Dois atalhos de marca pronta: "Pet shop" (`#2F6B4F`, `#E8833A`, linho, creme, friendly) e "Barbearia" (`#3A2A20`, `#C9A227`, couro, branco, classic).

- [ ] **Step 1:** Configurar Playwright (atenção: o Node pode não resolver `dev.localhost` no macOS, então a checagem de prontidão do `webServer` deve usar `http://127.0.0.1:3000` com um caminho que responda 2xx ou a opção de porta, não o host `dev.localhost`; o navegador resolve `*.localhost` sozinho) (`webServer: npm run dev`, `baseURL: http://dev.localhost:3000`, projetos `desktop` 1280×800 e `mobile` 375×812).
- [ ] **Step 2: Teste que falha** — `tests/e2e/vitrine.spec.ts`:

```ts
test('trocar a marca muda a capa ao vivo', async ({ page }) => {
  await page.goto('/vitrine')
  const cover = () => page.locator('[data-testid="demo-shell"]').evaluate((el) => getComputedStyle(el).getPropertyValue('--cover').trim())
  const before = await cover()
  await page.getByRole('button', { name: 'Barbearia' }).click()
  expect(await cover()).not.toBe(before)
  await expect(page.locator('[data-testid="demo-shell"]')).toHaveAttribute('data-material', 'leather')
})
test('cor de baixo contraste mostra aviso', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByLabel('Cor principal').fill('#808080')
  await expect(page.getByText('A cor principal foi escurecida para o texto ficar legível.')).toBeVisible()
})
test('cor inválida mostra erro e mantém a prévia anterior', async ({ page }) => {
  await page.goto('/vitrine')
  await page.getByLabel('Cor principal').fill('azul')
  await expect(page.getByText(/Use uma cor no formato #RRGGBB/)).toBeVisible()
})
test('sem rolagem horizontal', async ({ page }) => {
  await page.goto('/vitrine')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
test('capturas para revisão', async ({ page }, info) => {
  await page.goto('/vitrine')
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-padrao.png`, fullPage: true })
  await page.getByRole('button', { name: 'Pet shop' }).click()
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-petshop.png`, fullPage: true })
  await page.getByRole('button', { name: 'Barbearia' }).click()
  await page.screenshot({ path: `.local/screens/vitrine-${info.project.name}-barbearia.png`, fullPage: true })
})
```

- [ ] **Step 3:** Rodar `npm run test:e2e` → FALHA. Implementar molduras e vitrine.
- [ ] **Step 4:** `npm run test:e2e` → PASSA nos dois projetos. **Abrir as seis capturas em `.local/screens/` e olhar uma a uma**: texto cortado ou sobreposto, contraste fraco, relevo com luz incoerente, algo que pareça enfeite sem função. Corrigir e repetir até não achar nada.
- [ ] **Step 5:** `npm run typecheck && npm run lint && npm test && npm run build` → verde. Commit: `feat: molduras dos painéis e vitrine de componentes`.

---

### Task 12: Seed, partida com um comando e entrada nos painéis

**Files:**
- Modify: `package.json` (`dev` passa a ser `tsx scripts/dev.ts`), `.env.example` e `.env` (acrescenta `SEED_USER_PASSWORD`, `SEED_MULTI_EMAIL`), `playwright.config.ts` (carrega o `.env`)
- Create: `scripts/dev.ts`, `scripts/admin-create.ts`, `prisma/seed.ts`, `src/server/auth/guards.ts`, `src/server/domain/platform/branding.ts`, `src/app/dev/entrar/{page.tsx,actions.ts}`, `src/app/dev/(app)/{layout.tsx,page.tsx}`, `src/app/painel/entrar/{page.tsx,actions.ts,LoginForm.tsx}`, `src/app/painel/entrar/[slug]/page.tsx`, `src/app/painel/escolher-conta/{page.tsx,actions.ts}`, `src/app/painel/(app)/{layout.tsx,page.tsx}`, `README.md`
- Delete: `src/app/dev/page.tsx`, `src/app/painel/page.tsx` (provisórios da Tarefa 7)
- Test: `tests/e2e/entrada.spec.ts`, `tests/integration/branding.test.ts`

**Interfaces:**
- Consumes: Tarefas 2, 5, 6, 7, 8, 9, 11.
- Produces:

```ts
// domain/platform/branding.ts
export type PublicBrand = { businessId: string; slug: string; name: string
  logoUrl: string | null; symbolUrl: string | null; loginImageUrl: string | null
  loginMessage: string | null; theme: ThemeTokens }
export function getPublicBrandBySlug(slug: string): Promise<PublicBrand | null>   // null se não existe ou não está ACTIVE
export function getPublicBrandById(businessId: string): Promise<PublicBrand | null>
// auth/guards.ts ('server-only')
export const DEV_COOKIE = 'af_dev_session'; export const PAINEL_COOKIE = 'af_painel_session'; export const BRAND_COOKIE = 'af_brand'
export function requirePlatformAdmin(): Promise<Extract<Actor, { kind: 'platform_admin' }>>  // sem sessão → redirect('/entrar')
export function requireTenant(capability?: Capability): Promise<TenantContext>
  // sem sessão → redirect('/entrar'); sem conta ativa → redirect('/escolher-conta'); sem a capacidade → notFound()
```

Cookies: `httpOnly`, `sameSite: 'lax'`, `secure` em produção, `path: '/'`, sem atributo `Domain` (ficam presos ao host). `af_brand` guarda o `slug` da última conta acessada, por 1 ano.

Seed (idempotente: não duplica se rodar duas vezes): admin da plataforma com `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`; conta **Patas & Cia** (`patas-e-cia`, pet shop, `America/Sao_Paulo`, `#2F6B4F`, `#E8833A`, `LINEN`, `CREAM`, `FRIENDLY`, termos Tosador/Tosadores, Tutor/Tutores, Patinha/Patinhas, módulos fidelidade e banners); conta **Navalha de Ouro** (`navalha-de-ouro`, barbearia, `America/Manaus`, `#3A2A20`, `#C9A227`, `LEATHER`, `WHITE`, `CLASSIC`, termos Barbeiro/Barbeiros, todos os módulos). Usuários, todos com a senha de `SEED_USER_PASSWORD`: um dono de cada conta, um gerente e um profissional em cada, e **um usuário que é dono das duas** (`SEED_MULTI_EMAIL`). Os e-mails e senhas de demonstração ficam só em `.env.example`.

`scripts/dev.ts`: `startDb` → `prisma migrate deploy` → seed se `businesses` estiver vazio → `next dev -p 3000`; imprime os três endereços; em `SIGINT`/`SIGTERM` encerra o Next e o banco. Falha de partida do banco imprime só `describeStartFailure(...)` e sai com código 1. `scripts/admin-create.ts`: pede nome, e-mail e senha no terminal e cria um `platform_admin`.

Telas:
- `dev/entrar`: entrada do painel dev em `.material-metal`, marca AgendaFlui. Erros: "E-mail ou senha incorretos." / "Muitas tentativas. Tente de novo em N minutos."
- `dev/(app)`: `DevShell` com menu Visão geral, Contas, Chaves e API, Sistema, Auditoria, Admins (só Visão geral existe; os outros ainda não são links). Página inicial: lista as contas do banco com nome, slug, situação (`Lamp`) e o link de entrada de cada uma (`areaUrl('painel', '/entrar/' + slug)`), mais um link para a vitrine.
- `painel/entrar`: lê `af_brand`; se houver conta ativa com aquele slug, usa a marca dela; senão, a marca AgendaFlui. `painel/entrar/[slug]`: marca da conta; slug inexistente ou conta não ativa → `notFound()`. Ambas mostram logo, mensagem de entrada e imagem da conta quando existirem.
- Depois de entrar: uma conta → `/`; mais de uma → `/escolher-conta` (cartões com a marca de cada conta); nenhuma disponível → mensagem "Seu acesso não está ligado a nenhuma conta ativa. Fale com quem administra o seu negócio." e a sessão é encerrada.
- `painel/(app)`: `PainelShell` com o tema da conta ativa, menu Início, Agenda, Clientes, Equipe, Serviços, Relatórios, Configurações (os rótulos de Equipe e Clientes são o plural dos termos da conta, por exemplo "Barbeiros" e "Tutores"; só Início é link, os demais aparecem desabilitados com `aria-disabled` até a fase que os cria; no celular a barra mostra Início, Agenda, Clientes, Equipe e "Mais"). O botão "Sair" fica alcançável por `getByRole('button', { name: 'Sair' })` nos dois tamanhos de tela. Início: "Olá, {primeiro nome}" e a data de hoje **no fuso da conta** via `todayIn` + `formatDate`. Menu do usuário: trocar de conta (se tiver mais de uma) e sair. Entrar grava `af_brand`.

- [ ] **Step 1: Teste que falha** — `tests/integration/branding.test.ts`: `getPublicBrandBySlug` devolve o tema derivado das cores gravadas (`theme.material === 'linen'` para uma conta `LINEN`); devolve `null` para slug inexistente e para conta `SUSPENDED`; `logoUrl` é `null` sem upload e `'/arquivos/…'` com upload.
- [ ] **Step 2: Teste que falha** — `tests/e2e/entrada.spec.ts` (credenciais lidas de `process.env`, carregadas do `.env`; URLs absolutas por host):

```ts
const DEV = 'http://dev.localhost:3000', PAINEL = 'http://painel.localhost:3000'
test('admin entra no painel dev e vê as contas', async ({ page }) => {
  await page.goto(`${DEV}/`); await expect(page).toHaveURL(`${DEV}/entrar`)
  await page.getByLabel('E-mail').fill(process.env.SEED_ADMIN_EMAIL!)
  await page.getByLabel('Senha').fill(process.env.SEED_ADMIN_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Patas & Cia')).toBeVisible()
  await expect(page.getByText('Navalha de Ouro')).toBeVisible()
})
test('senha errada mostra erro e não entra', async ({ page }) => {
  await page.goto(`${DEV}/entrar`)
  await page.getByLabel('E-mail').fill(process.env.SEED_ADMIN_EMAIL!)
  await page.getByLabel('Senha').fill('senha-errada-123')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('E-mail ou senha incorretos.')).toBeVisible()
})
test('link de entrada da conta já vem com a marca dela', async ({ page }) => {
  await page.goto(`${PAINEL}/entrar/patas-e-cia`)
  await expect(page.getByText('Patas & Cia')).toBeVisible()
  await expect(page.locator('[data-material="linen"]').first()).toBeVisible()
})
test('slug inexistente é 404', async ({ page }) => {
  expect((await page.goto(`${PAINEL}/entrar/nao-existe`))?.status()).toBe(404)
})
test('dono de duas contas escolhe, entra, e a entrada passa a lembrar a marca', async ({ page }) => {
  await page.goto(`${PAINEL}/entrar`)
  await page.getByLabel('E-mail').fill(process.env.SEED_MULTI_EMAIL!)
  await page.getByLabel('Senha').fill(process.env.SEED_USER_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(`${PAINEL}/escolher-conta`)
  await page.getByRole('button', { name: /Navalha de Ouro/ }).click()
  await expect(page.locator('[data-material="leather"]').first()).toBeVisible()
  await expect(page.getByText('Barbeiros')).toBeVisible()
  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(`${PAINEL}/entrar`)
  await expect(page.getByText('Navalha de Ouro')).toBeVisible()
})
test('sessão do painel dev não vale no painel do negócio', async ({ page }) => {
  await page.goto(`${DEV}/entrar`)
  await page.getByLabel('E-mail').fill(process.env.SEED_ADMIN_EMAIL!)
  await page.getByLabel('Senha').fill(process.env.SEED_ADMIN_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.goto(`${PAINEL}/`); await expect(page).toHaveURL(`${PAINEL}/entrar`)
})
test('painel do negócio não alcança rotas do painel dev', async ({ page }) => {
  expect((await page.goto(`${PAINEL}/dev/entrar`))?.status()).toBe(404)
})
```

- [ ] **Step 3:** Rodar → FALHA. Implementar seed, scripts, guards, domínio de marca e telas.
- [ ] **Step 4:** `npm run db:reset && npm run test:e2e` → PASSA nos dois projetos. Capturar e olhar `painel/entrar/patas-e-cia`, `painel/entrar/navalha-de-ouro`, o início de cada conta e `dev/` em 375 e 1280 px, como na Tarefa 11.
- [ ] **Step 5:** `README.md` (até 60 linhas): o que é, requisitos (Node 22.18+), `cp .env.example .env`, `npm install`, `npm run dev`, os três endereços locais, onde estão as credenciais de demonstração, tabela de comandos, estrutura de pastas em 10 linhas.
- [ ] **Step 6:** Verificação final da fase, do zero: `rm -rf .local .next && npm run typecheck && npm run lint && npm test && npm run test:tz && npm run build && npm run test:e2e` → tudo verde. `grep -rniE "sejasans|sans (company|club|coins)|clube_sans|barber" src prisma scripts tests` → nenhuma ocorrência.
- [ ] **Step 7:** Commit: `feat: seed, partida com um comando e entrada nos dois painéis`.

---

## Parada ao fim da fase

Com a Tarefa 12 concluída, o dono do projeto abre `http://dev.localhost:3000/vitrine` e as telas de entrada e **aprova ou ajusta o visual** antes de a Fase 2 (núcleo de agenda) e as telas em série começarem.
