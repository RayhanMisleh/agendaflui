# AgendaFlui — Fase 2A: Núcleo de agenda (domínio) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir o domínio de agenda do AgendaFlui, sem telas e sem API: serviços, equipe, expediente, bloqueios, fechamentos, clientes, horários livres, agendamentos e a fila de avisos, tudo testado contra o Postgres real.

**Architecture:** Cada área é um módulo em `src/server/domain/<área>/` com funções `fn(ctx: TenantContext, entrada)`. O `ctx` carrega a conta, o fuso, o ator, um relógio e o cliente `db` já filtrado pela conta. Toda entrada é validada com Zod; todo erro esperado é um `DomainError` com código. O cálculo de horários livres é uma função pura; a garantia de "nunca dois agendamentos sobrepostos" é do banco (restrição de exclusão), com uma trava por profissional para as demais regras.

**Tech Stack:** a mesma da Fase 1 (Next 16.4.6, TypeScript estrito, Prisma 7.10.1, Postgres embutido, Zod 4, `temporal-polyfill`, Vitest). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-13-agendaflui-design.md` — leia as seções 5.3, 5.4, 6, 7, 8 e 9.1 antes de qualquer tarefa. A Fase 2 da spec foi dividida em duas: esta (2A, domínio) e a 2B (API `v1`, chaves, login de cliente, envio de avisos).

## Global Constraints

- Tudo o que vale na Fase 1 continua valendo (ver `AGENTS.md`): TypeScript estrito sem `any`/`@ts-ignore`; data e hora só por `src/server/time/`; dados de conta só por `tenantDb`/`ctx.db`; o `prisma` cru só nas pastas liberadas; nenhum termo do sistema antigo; textos em pt-BR; commits locais, nunca `git push`; `_legacy/` só leitura.
- Prisma 7 e Next 16 têm APIs diferentes das versões anteriores: consulte a documentação instalada em `node_modules` antes de assumir.
- Código de domínio fica em `src/server/domain/**` e NÃO importa o `prisma` cru (exceto `domain/platform/**`). Recebe `ctx` e usa `ctx.db`.
- Tabela nova de conta: coluna `business_id` obrigatória; `@@unique([businessId, id])`; toda FK para outra tabela de conta é composta com `business_id` e `ON UPDATE NO ACTION`; classificada em `src/server/db/models.ts`. O teste estrutural (`tests/integration/schema.test.ts`) precisa passar.
- Dinheiro em centavos inteiros (`*Cents`). Comissão em pontos-base inteiros (`commissionBps`, 0 a 10000). Instantes em `timestamptz`. Datas de calendário em coluna `date`, convertidas só pelas funções do módulo de tempo. Hora de expediente em minutos desde a meia-noite local (inteiro), nunca coluna `time`.
- Nenhuma função de domínio lê `new Date()` direto: usa `ctx.clock()`.
- Erros esperados são `DomainError` (Tarefa 1). Mensagens em pt-BR, dizendo o que houve e como resolver. Erro inesperado sobe como exceção comum.
- Toda função de domínio que altera dado confere a permissão com `authorize` ou com a regra de dono do recurso descrita na tarefa. Esconder na tela não protege nada.
- Registros com histórico (cliente, profissional, serviço) são arquivados (`archivedAt`), nunca apagados.
- TDD de verdade: teste primeiro, saída do RED guardada antes de implementar.
- Não criar arquivos de documentação além dos listados.

## Review Focus

1. **Agendamento que atravessa a meia-noite local ou encosta no fim do expediente** (serviço de 60 min às 23:30; expediente até 24:00): o horário só é oferecido se couber inteiro no expediente; nada quebra na virada do dia. Teste nas Tarefas 3 e 7.
2. **Lista de serviços malformada ao marcar** (vazia, com repetidos, com serviço arquivado, inativo ou de outra conta; profissional que não faz um dos serviços): erro de validação claro por campo, nada gravado. Teste na Tarefa 9.
3. **Dois pedidos para o mesmo horário ao mesmo tempo, ou o mesmo pedido enviado duas vezes** (duplo clique): exatamente um agendamento existe no fim; o outro recebe `slot_taken`. Teste na Tarefa 9.
4. **Telefone e e-mail de cliente em formatos soltos** (`(11) 91234-5678`, `+55 11 91234-5678`, `11912345678`, e-mail com maiúsculas e espaços): normalizados para a mesma forma; telefone curto demais é recusado com mensagem clara. Teste na Tarefa 6.
5. **Mudar expediente, arquivar serviço ou arquivar profissional quando já existem agendamentos futuros**: os agendamentos existentes continuam válidos e visíveis; arquivar profissional com agendamentos futuros ativos é recusado dizendo quantos são. Teste nas Tarefas 5 e 8.

---

## Mapa de arquivos

```
prisma/schema.prisma                         + modelos da agenda
prisma/migrations/<ts>_scheduling/           tabelas, FKs compostas, restrição de exclusão
src/server/db/models.ts                      + classificação dos modelos novos
src/server/db/tenant.ts                      + $lockKey, campos permitidos de Business
src/server/auth/actor.ts                     Actor (+ customer, membershipId), TenantContext novo
src/server/auth/context.ts                   createTenantContext
src/server/time/index.ts                     + minuteToInstant, datas de banco, rótulos de minuto
src/server/domain/errors.ts                  DomainError, authorize, parse
src/server/domain/audit.ts                   registro de auditoria
src/server/domain/settings/                  scheduling-rules.ts, notification-settings.ts, closures.ts
src/server/domain/catalog/services.ts
src/server/domain/team/                      professionals.ts, working-hours.ts, time-blocks.ts
src/server/domain/customers/                 customers.ts, contact.ts
src/server/domain/scheduling/                slots.ts (puro), availability.ts, appointments.ts, agenda.ts, status.ts
src/server/domain/notifications/outbox.ts
prisma/seed-data.ts, prisma/seed.ts          + dados de demonstração da agenda
tests/setup/factories.ts                     + fábricas da agenda, makeCtx
tests/unit/**, tests/integration/**          um arquivo por módulo
```

---

### Task 1: Contexto de conta, erros de domínio e auditoria

**Files:**
- Modify: `src/server/auth/actor.ts`, `src/server/auth/capabilities.ts`, `src/server/auth/member-auth.ts`, `src/server/auth/guards.ts` (só o que o tipo novo exigir), `src/server/db/tenant.ts`, `tests/setup/factories.ts`
- Create: `src/server/auth/context.ts`, `src/server/domain/errors.ts`, `src/server/domain/audit.ts`
- Test: `tests/unit/domain-errors.test.ts`, `tests/integration/context.test.ts`; ajustar `tests/integration/tenant.test.ts` e `auth.test.ts`

**Interfaces:**
- Produces:

```ts
// auth/actor.ts
export type Actor =
  | { kind: 'platform_admin'; adminId: string; name: string }
  | { kind: 'member'; userId: string; membershipId: string; name: string; role: MembershipRole }
  | { kind: 'impersonator'; adminId: string; name: string }
  | { kind: 'customer'; customerId: string; name: string }
  | { kind: 'system' }
export type RequestInfo = { ip: string | null; userAgent: string | null }
export type TenantContext = {
  businessId: string
  timeZone: string
  actor: Actor
  db: TenantClient           // criado uma vez por contexto
  clock: () => Date          // padrão: () => new Date()
  request: RequestInfo       // padrão: { ip: null, userAgent: null }
}
// auth/context.ts  ('server-only')
export function createTenantContext(i: { businessId: string; actor: Actor; clock?: () => Date; request?: RequestInfo }): Promise<TenantContext>
// lança DomainError('not_found') se a conta não existe e DomainError('business_unavailable') se não está ACTIVE
// domain/errors.ts
export type DomainErrorCode = 'validation' | 'not_found' | 'forbidden' | 'conflict' | 'business_unavailable' | 'module_disabled'
export class DomainError extends Error {
  code: DomainErrorCode
  reason?: string                       // subcódigo estável, ex.: 'slot_taken'
  fields?: Record<string, string>       // campo → mensagem
  details?: Record<string, unknown>
  constructor(code: DomainErrorCode, message: string, extra?: { reason?: string; fields?: Record<string, string>; details?: Record<string, unknown> })
}
export function authorize(ctx: TenantContext, capability: Capability): void          // lança DomainError('forbidden', 'Você não tem permissão para fazer isso.')
export function parse<T>(schema: z.ZodType<T>, input: unknown): T                     // ZodError → DomainError('validation') com fields (caminho com pontos → primeira mensagem)
export function orNotFound<T>(value: T | null | undefined, what: string): T          // lança DomainError('not_found', `${what} não encontrado.`)
export function isRecordNotFound(err: unknown): boolean                               // erro P2025 do Prisma
// domain/audit.ts
export function audit(ctx: TenantContext, entry: { action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> }): Promise<void>
// tests/setup/factories.ts
export function makeCtx(business: { id: string }, opts?: { actor?: Actor; now?: Date }): Promise<TenantContext>   // ator padrão: member OWNER criado na hora
```

Regras: `can()` devolve `false` para `customer` em todas as capacidades. `getTenantContext` passa a usar `createTenantContext` (preenche `membershipId`). `audit` grava em `auditLog` pelo `ctx.db` com `actorType` (`USER` para member, `PLATFORM_ADMIN` com `onBehalf: true` para impersonator, `SYSTEM` para system e customer; para customer, `metadata.customerId`), `actorName`, `ip` de `ctx.request`.

Em `tenantDb`, `Business` só aceita `update`/`updateMany` dos campos `name`, `segment`, `document`, `email`, `phone`, `addressLine`, `city`, `state`, `postalCode`; qualquer outro campo em `data` lança `TenantViolationError` (situação, slug, fuso e observações internas só mudam pelo código da plataforma).

- [ ] **Step 1: Testes que falham.** `tests/unit/domain-errors.test.ts`: `parse` com `z.object({ name: z.string().min(1, 'Informe o nome.'), price: z.number().int() })` e entrada `{ name: '', price: 1.5 }` lança `DomainError` com `code === 'validation'` e `fields.name === 'Informe o nome.'` e `fields.price` definido; `orNotFound(null, 'Serviço')` lança `not_found` com mensagem `'Serviço não encontrado.'`; `authorize` com ator `customer` lança `forbidden`. `tests/integration/context.test.ts`: `createTenantContext` devolve `timeZone` da conta e um `db` que só enxerga a conta; conta `SUSPENDED` lança `business_unavailable`; conta inexistente lança `not_found`; `ctx.clock()` usa o relógio injetado; `audit` grava linha com `businessId`, `actorType 'USER'`, `actorName` e `action`; com `impersonator`, `onBehalf` é `true`; `ctx.db.business.update({ data: { status: 'SUSPENDED' } })`, `{ slug }`, `{ timezone }` e `{ internalNotes }` lançam `TenantViolationError` e `{ name: 'Novo' }` funciona.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Ajustar os usos de `TenantContext` e de `Actor` existentes (`src/app/painel/**`, guards, testes).
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test && npm run build` → verde.
- [ ] **Step 4:** Commit: `feat: contexto de conta com db e relógio, erros de domínio e auditoria`.

---

### Task 2: Tabelas da agenda

**Files:**
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `tests/integration/schema.test.ts`
- Create: `prisma/migrations/<timestamp>_scheduling/migration.sql`
- Test: `tests/integration/scheduling-schema.test.ts`

**Interfaces:**
- Produces: modelos Prisma abaixo, todos em `TENANT_MODELS`. Enums: `Weekday { SUNDAY MONDAY TUESDAY WEDNESDAY THURSDAY FRIDAY SATURDAY }`, `AppointmentStatus { PENDING CONFIRMED COMPLETED CANCELED NO_SHOW }`, `AppointmentSource { APP PANEL }`, `PartyType { CUSTOMER MEMBER PLATFORM_ADMIN SYSTEM }`, `NotificationKind { APPOINTMENT_CONFIRMED APPOINTMENT_CANCELED APPOINTMENT_RESCHEDULED APPOINTMENT_REMINDER_24H APPOINTMENT_REMINDER_1H APPOINTMENT_COMPLETED PROFESSIONAL_FREE_EARLY STAFF_NEW_APPOINTMENT STAFF_APPOINTMENT_CANCELED STAFF_APPOINTMENT_RESCHEDULED }`, `NotificationChannel { EMAIL PUSH }`, `NotificationStatus { PENDING SENT FAILED CANCELED SKIPPED }`, `CustomerOrigin { APP PANEL }`.

Todas as tabelas têm `id uuid`, `business_id` (FK para `businesses`, cascade), `created_at`, `updated_at` e `@@unique([businessId, id])`. "→ X" quer dizer FK composta `(business_id, coluna) → X (business_id, id)`.

| Tabela (modelo) | Colunas |
|---|---|
| `customers` (`Customer`) | `name`, `email?`, `phone?`, `password_hash?`, `email_verified_at?`, `avatar_upload_id?` → uploads (set null só da coluna), `birth_date? date`, `notes?`, `is_club_member bool = false`, `notify_push_appointments bool = true`, `notify_email_appointments bool = true`, `notify_push_marketing bool = true`, `notify_email_marketing bool = false`, `origin CustomerOrigin`, `archived_at?`, `anonymized_at?`; índice único parcial `(business_id, email) WHERE email IS NOT NULL`; índice `(business_id, phone)`; índice `(business_id, name)` |
| `professionals` (`Professional`) | `membership_id?` → memberships (set null só da coluna), único parcial `(business_id, membership_id) WHERE membership_id IS NOT NULL`; `name`, `avatar_upload_id?` → uploads, `bio?`, `commission_bps int = 0`, `active bool = true`, `display_order int = 0`, `archived_at?` |
| `services` (`Service`) | `name`, `description?`, `icon = 'sparkles'`, `price_cents int`, `duration_min int`, `reward_points int = 0`, `club_only bool = false`, `active bool = true`, `display_order int = 0`, `archived_at?` |
| `professional_services` (`ProfessionalService`) | `professional_id` → professionals (cascade), `service_id` → services (cascade); único `(professional_id, service_id)` |
| `working_hours` (`WorkingHours`) | `professional_id` → professionals (cascade), `weekday Weekday`, `start_min int`, `end_min int`; índice `(business_id, professional_id, weekday)` |
| `time_blocks` (`TimeBlock`) | `professional_id` → professionals (cascade), `starts_at`, `ends_at`, `reason?`, `created_by_type PartyType`, `created_by_id uuid?`; índice `(business_id, professional_id, starts_at)` |
| `business_closures` (`BusinessClosure`) | `start_date date`, `end_date date` (inclusive), `reason?`; índice `(business_id, start_date)` |
| `appointments` (`Appointment`) | `customer_id` → customers (restrict), `professional_id` → professionals (restrict), `starts_at`, `ends_at`, `status AppointmentStatus`, `source AppointmentSource`, `total_cents int`, `total_duration_min int`, `commission_cents int?`, `notes?`, `created_by_type PartyType`, `created_by_id uuid?`, `canceled_at?`, `canceled_by_type PartyType?`, `canceled_by_id uuid?`, `cancel_reason?`, `completed_at?`; índices `(business_id, starts_at)`, `(business_id, professional_id, starts_at)`, `(business_id, customer_id, starts_at)` |
| `appointment_items` (`AppointmentItem`) | `appointment_id` → appointments (cascade), `service_id` → services (restrict), `name`, `price_cents int`, `duration_min int`, `reward_points int`, `position int`; único `(appointment_id, position)` |
| `notifications` (`Notification`) | `kind NotificationKind`, `channel NotificationChannel`, `customer_id?` → customers (cascade), `membership_id?` → memberships (cascade), `appointment_id?` → appointments (cascade), `scheduled_for`, `status NotificationStatus = PENDING`, `attempts int = 0`, `last_error?`, `sent_at?`, `payload jsonb = '{}'`, `dedupe_key`; único `(business_id, dedupe_key)`; índice `(status, scheduled_for)` |

`memberships` ganha `@@unique([businessId, id])` (para as FKs compostas). FK composta com `ON DELETE SET NULL` usa a lista de colunas do Postgres (`SET NULL (coluna)`), em SQL puro, como na migração `…_tenant_upload_fks`.

Restrições em SQL puro: `customers`: e-mail `= lower(btrim(email))`, telefone `~ '^[0-9]{10,15}$'`, exatamente um destinatário não é exigido aqui. `professionals.commission_bps BETWEEN 0 AND 10000`. `services`: `price_cents >= 0`, `duration_min BETWEEN 5 AND 600`, `duration_min % 5 = 0`, `reward_points >= 0`. `working_hours`: `start_min >= 0`, `end_min <= 1440`, `start_min < end_min`. `time_blocks`, `appointments`: `starts_at < ends_at`. `business_closures`: `start_date <= end_date`. `appointments`: `total_cents >= 0`, `total_duration_min > 0`. `notifications`: `(customer_id IS NULL) <> (membership_id IS NULL)`.

Restrição de exclusão (precisa de `CREATE EXTENSION IF NOT EXISTS btree_gist`):

```sql
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (professional_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED', 'COMPLETED'));
```

- [ ] **Step 1: Teste que falha** — `tests/integration/scheduling-schema.test.ts` (com `resetDb` e as fábricas mínimas criadas no próprio teste com o `prisma` cru): dois agendamentos `CONFIRMED` do mesmo profissional com intervalos sobrepostos → o segundo é recusado, e a mensagem ou o código do erro identifica `appointments_no_overlap`; intervalos que só se encostam (um termina 10:00, outro começa 10:00) → os dois são aceitos; sobreposto a um `CANCELED` → aceito; mesmo intervalo com outro profissional → aceito; agendamento com `customer_id` de outra conta → recusado pela FK composta; `working_hours` com `start_min 600, end_min 600` → recusado; `services.duration_min = 7` → recusado; telefone `'119'` → recusado; dois clientes da mesma conta com o mesmo e-mail → recusado, em contas diferentes → aceito; dois clientes sem e-mail → aceitos; `notifications` sem destinatário e com dois destinatários → recusadas; mesma `dedupe_key` na mesma conta → recusada. O teste estrutural existente (`schema.test.ts`) continua passando com as tabelas novas.
- [ ] **Step 2:** Rodar → FALHA. Escrever schema e migração (gerar com `prisma migrate diff` e completar o SQL puro). Classificar os modelos.
- [ ] **Step 3:** `npx vitest run tests/integration/scheduling-schema.test.ts tests/integration/schema.test.ts tests/integration/tenant.test.ts` → PASSA. `npm run typecheck && npm run lint && npm test` → verde.
- [ ] **Step 4:** Commit: `feat: tabelas da agenda com restrição de sobreposição no banco`.

---

### Task 3: Tempo — minutos do dia e datas de banco

**Files:**
- Modify: `src/server/time/index.ts`, `package.json` (`test:tz` passa a rodar também `tests/unit/slots.test.ts` quando ele existir; nesta tarefa, acrescente `tests/unit/time-extra.test.ts`)
- Test: `tests/unit/time-extra.test.ts`

**Interfaces:**
- Produces:

```ts
export const WEEKDAYS: readonly Weekday[]                                  // SUNDAY … SATURDAY
export function minuteToInstant(date: string, minuteOfDay: number, tz: string): Date   // 0..1440; 1440 = 00:00 do dia seguinte
export function minuteOfDay(instant: Date, tz: string): number             // 0..1439
export function minuteLabel(minute: number): string                        // 540 → '09:00'; 1440 → '24:00'
export function parseMinuteLabel(label: string): number                    // 'HH:mm' (00:00..24:00) → minutos; inválido → RangeError
export function dbDateToLocal(d: Date): string                             // Date de coluna `date` (00:00 UTC) → 'YYYY-MM-DD'
export function localToDbDate(date: string): Date                          // 'YYYY-MM-DD' → Date 00:00 UTC, para coluna `date`
export function isoWeekRange(date: string): { start: string; end: string } // segunda a domingo que contêm a data
export function compareLocalDates(a: string, b: string): -1 | 0 | 1
export function daysBetween(a: string, b: string): number                  // b − a em dias
```

- [ ] **Step 1: Teste que falha:**

```ts
const iso = (d: Date) => d.toISOString()
test('minuto do dia vira instante no fuso da conta', () => {
  expect(iso(minuteToInstant('2026-11-16', 540, 'America/Sao_Paulo'))).toBe('2026-11-16T12:00:00.000Z')
  expect(iso(minuteToInstant('2026-11-16', 540, 'America/Manaus'))).toBe('2026-11-16T13:00:00.000Z')
})
test('1440 é a meia-noite do dia seguinte', () => {
  expect(iso(minuteToInstant('2026-11-16', 1440, 'America/Sao_Paulo'))).toBe('2026-11-17T03:00:00.000Z')
  expect(iso(minuteToInstant('2026-12-31', 1440, 'America/Sao_Paulo'))).toBe('2027-01-01T03:00:00.000Z')
})
test('minuto inexistente em Nova York avança; fora de 0..1440 lança', () => {
  expect(iso(minuteToInstant('2026-03-08', 150, 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z')
  expect(() => minuteToInstant('2026-11-16', 1441, 'America/Sao_Paulo')).toThrow(RangeError)
  expect(() => minuteToInstant('2026-11-16', -1, 'America/Sao_Paulo')).toThrow(RangeError)
})
test('minuteOfDay é a inversa', () => {
  expect(minuteOfDay(new Date('2026-11-16T12:30:00.000Z'), 'America/Sao_Paulo')).toBe(570)
  expect(minuteOfDay(new Date('2026-11-17T02:59:00.000Z'), 'America/Sao_Paulo')).toBe(1439)
})
test('rótulos de minuto', () => {
  expect(minuteLabel(0)).toBe('00:00'); expect(minuteLabel(545)).toBe('09:05'); expect(minuteLabel(1440)).toBe('24:00')
  expect(parseMinuteLabel('09:05')).toBe(545); expect(parseMinuteLabel('24:00')).toBe(1440)
  for (const bad of ['24:01', '9:5', '25:00', 'abc', '']) expect(() => parseMinuteLabel(bad)).toThrow(RangeError)
})
test('datas de banco não dependem do fuso do processo', () => {
  expect(dbDateToLocal(new Date('2026-11-16T00:00:00.000Z'))).toBe('2026-11-16')
  expect(iso(localToDbDate('2026-11-16'))).toBe('2026-11-16T00:00:00.000Z')
  expect(() => localToDbDate('2026-02-30')).toThrow(RangeError)
})
test('semana, comparação e diferença de datas', () => {
  expect(isoWeekRange('2026-11-18')).toEqual({ start: '2026-11-16', end: '2026-11-22' })
  expect(isoWeekRange('2026-11-22')).toEqual({ start: '2026-11-16', end: '2026-11-22' })
  expect(compareLocalDates('2026-11-16', '2026-11-17')).toBe(-1)
  expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3)
})
```

- [ ] **Step 2:** Rodar → FALHA. Implementar com Temporal. Rodar → PASSA; `npm run test:tz` → PASSA nos três fusos.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: minutos do dia e datas de calendário no módulo de tempo`.

---

### Task 4: Serviços e regras de agenda

**Files:**
- Create: `src/server/domain/catalog/services.ts`, `src/server/domain/settings/scheduling-rules.ts`
- Modify: `tests/setup/factories.ts` (`makeService`)
- Test: `tests/integration/services.test.ts`, `tests/integration/scheduling-rules.test.ts`

**Interfaces:**
- Consumes: `TenantContext`, `authorize`, `parse`, `orNotFound`, `audit`.
- Produces:

```ts
// catalog/services.ts
export type ServiceView = { id: string; name: string; description: string | null; icon: string; priceCents: number;
  durationMin: number; rewardPoints: number; clubOnly: boolean; active: boolean; displayOrder: number; archived: boolean }
export type ServiceInput = { name: string; description?: string | null; icon?: string; priceCents: number; durationMin: number;
  rewardPoints?: number; clubOnly?: boolean; active?: boolean }
export function listServices(ctx: TenantContext, opts?: { includeInactive?: boolean; includeArchived?: boolean }): Promise<ServiceView[]>   // ordena por displayOrder, nome
export function getService(ctx: TenantContext, id: string): Promise<ServiceView>
export function createService(ctx: TenantContext, input: ServiceInput): Promise<ServiceView>
export function updateService(ctx: TenantContext, id: string, input: Partial<ServiceInput>): Promise<ServiceView>
export function archiveService(ctx: TenantContext, id: string): Promise<void>
export function restoreService(ctx: TenantContext, id: string): Promise<ServiceView>
export function reorderServices(ctx: TenantContext, orderedIds: string[]): Promise<void>
// settings/scheduling-rules.ts
export type SchedulingRules = { slotStepMin: number; minLeadMin: number; maxAdvanceDays: number; customerChangeWindowMin: number; bufferMin: number; autoConfirm: boolean }
export function getSchedulingRules(ctx: TenantContext): Promise<SchedulingRules>
export function updateSchedulingRules(ctx: TenantContext, input: Partial<SchedulingRules>): Promise<SchedulingRules>
```

Regras: escrita de serviço exige `manage_catalog`; leitura é livre para qualquer ator da conta (cliente só enxerga `active` e não arquivados, mesmo pedindo o contrário). Validação: `name` 1 a 80 caracteres (aparado); `description` até 500; `icon` 1 a 40; `priceCents` inteiro 0 a 10.000.000; `durationMin` 5 a 600, múltiplo de 5; `rewardPoints` inteiro 0 a 100.000. `reorderServices` exige a lista exata dos serviços não arquivados (senão `validation`). Escritas gravam auditoria (`service.created`, `service.updated`, `service.archived`, `service.restored`). `updateSchedulingRules` exige `manage_settings`; `slotStepMin ∈ {5, 10, 15, 20, 30, 60}`; `minLeadMin` 0 a 10080; `maxAdvanceDays` 1 a 365; `customerChangeWindowMin` 0 a 10080; `bufferMin` 0 a 120, múltiplo de 5.

- [ ] **Step 1: Testes que falham** (cada um com `makeCtx`): cria serviço e o lê de volta com os padrões (`icon 'sparkles'`, `active true`, `rewardPoints 0`); nome vazio, duração 7, preço negativo e preço 1.5 dão `validation` com o campo certo em `fields`; profissional (papel `PROFESSIONAL`) não cria (`forbidden`) mas lista; ator `customer` não vê serviço inativo nem arquivado; serviço de outra conta dá `not_found` em `getService`, `updateService` e `archiveService`; arquivar some da lista padrão e aparece com `includeArchived`; `restoreService` volta; `reorderServices` com lista incompleta dá `validation` e com lista completa muda a ordem; cada escrita deixa uma linha de auditoria. Regras: `getSchedulingRules` devolve os padrões (15, 60, 60, 120, 0, true); `slotStepMin: 7` e `bufferMin: 7` dão `validation`; gerente altera, profissional não.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: serviços e regras de agenda`.

---

### Task 5: Equipe, expediente, bloqueios e fechamentos

**Files:**
- Create: `src/server/domain/team/professionals.ts`, `working-hours.ts`, `time-blocks.ts`, `src/server/domain/settings/closures.ts`
- Modify: `tests/setup/factories.ts` (`makeProfessional`, `makeWorkingHours`)
- Test: `tests/integration/professionals.test.ts`, `working-hours.test.ts`, `time-blocks.test.ts`, `closures.test.ts`

**Interfaces:**
- Produces:

```ts
// team/professionals.ts
export type ProfessionalView = { id: string; name: string; bio: string | null; avatarUrl: string | null; commissionBps: number;
  active: boolean; displayOrder: number; archived: boolean; membershipId: string | null; serviceIds: string[] }
export type ProfessionalInput = { name: string; bio?: string | null; commissionBps?: number; active?: boolean; membershipId?: string | null; serviceIds?: string[] }
export function listProfessionals(ctx: TenantContext, opts?: { includeInactive?: boolean; includeArchived?: boolean; serviceIds?: string[] }): Promise<ProfessionalView[]>
export function getProfessional(ctx: TenantContext, id: string): Promise<ProfessionalView>
export function createProfessional(ctx: TenantContext, input: ProfessionalInput): Promise<ProfessionalView>
export function updateProfessional(ctx: TenantContext, id: string, input: Partial<ProfessionalInput>): Promise<ProfessionalView>
export function archiveProfessional(ctx: TenantContext, id: string): Promise<void>
export function ownProfessionalId(ctx: TenantContext): Promise<string | null>     // profissional ligado ao membership do ator; null se não houver
export function assertCanManageProfessional(ctx: TenantContext, professionalId: string): Promise<void>  // manage_team, ou o próprio com manage_own_availability
// team/working-hours.ts
export type DayRanges = { startMin: number; endMin: number }[]
export type WeekSchedule = Record<Weekday, DayRanges>
export function getWeekSchedule(ctx: TenantContext, professionalId: string): Promise<WeekSchedule>
export function setWeekSchedule(ctx: TenantContext, professionalId: string, schedule: Partial<WeekSchedule>): Promise<WeekSchedule>  // substitui os dias informados
// team/time-blocks.ts
export type TimeBlockView = { id: string; professionalId: string; startsAt: Date; endsAt: Date; reason: string | null }
export function listTimeBlocks(ctx: TenantContext, q: { professionalId: string; from: string; to: string }): Promise<TimeBlockView[]>  // datas locais, inclusive
export function createTimeBlock(ctx: TenantContext, i: { professionalId: string; startsAt: Date; endsAt: Date; reason?: string | null }): Promise<TimeBlockView>
export function deleteTimeBlock(ctx: TenantContext, id: string): Promise<void>
// settings/closures.ts
export type ClosureView = { id: string; startDate: string; endDate: string; reason: string | null }
export function listClosures(ctx: TenantContext, q?: { from?: string; to?: string }): Promise<ClosureView[]>
export function createClosure(ctx: TenantContext, i: { startDate: string; endDate: string; reason?: string | null }): Promise<ClosureView>
export function deleteClosure(ctx: TenantContext, id: string): Promise<void>
export function isClosedOn(ctx: TenantContext, date: string): Promise<boolean>
```

Regras: profissional — `name` 1 a 80; `commissionBps` 0 a 10000; `serviceIds` precisam ser serviços não arquivados da conta; omitir `serviceIds` na criação liga o profissional a todos os serviços não arquivados; `membershipId` precisa ser vínculo ativo da conta e sem outro profissional. Criar, alterar e arquivar exigem `manage_team`. `archiveProfessional` é recusado com `conflict` (`reason: 'has_future_appointments'`, `details.count`) se houver agendamento `PENDING` ou `CONFIRMED` com `startsAt >= ctx.clock()`; a mensagem diz quantos são. Cliente só enxerga ativos e não arquivados. Expediente — cada intervalo com `0 <= startMin < endMin <= 1440`, múltiplos de 5; intervalos do mesmo dia não podem se sobrepor nem se encostar fora de ordem (devolvidos ordenados); no máximo 6 por dia; `setWeekSchedule` troca os dias informados numa transação e não toca nos demais. Bloqueio — `startsAt < endsAt`, duração máxima de 60 dias; grava `createdByType`/`createdById` do ator; não é recusado por existir agendamento no intervalo (o agendamento continua; o bloqueio só impede novos). Fechamento — datas válidas, `startDate <= endDate`, no máximo 366 dias; exige `manage_settings`. Expediente e bloqueio usam `assertCanManageProfessional`. Escritas gravam auditoria.

- [ ] **Step 1: Testes que falham.** Profissionais: cria ligado a todos os serviços por padrão; `serviceIds` de outra conta ou arquivado dá `validation`; `listProfessionals({ serviceIds: [a, b] })` só traz quem faz os dois; `membershipId` já usado dá `conflict`; arquivar com 2 agendamentos futuros confirmados dá `conflict` com `details.count === 2` e mensagem contendo "2"; com agendamento só no passado ou cancelado, arquiva; `ownProfessionalId` devolve o id para o membro ligado e `null` para o dono sem ficha; profissional altera o próprio expediente mas não o de um colega (`forbidden`); gerente altera o de qualquer um. Expediente: `setWeekSchedule(p, { MONDAY: [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1080 }] })` devolve a semana com a segunda preenchida e os outros dias vazios; sobreposição (`540–720` e `700–800`), `startMin 545` com passo de 5 é aceito e `startMin 547` recusado, `endMin 1441` recusado, 7 intervalos recusado; trocar a segunda não muda a terça; expediente até 1440 é aceito. Bloqueios: cria e lista por intervalo de datas locais no fuso da conta (bloqueio de `2026-11-17T02:00Z` a `2026-11-17T04:00Z`, em São Paulo, aparece na consulta de 16 e de 17); fim antes do início dá `validation`; apagar bloqueio de outra conta dá `not_found`. Fechamentos: `isClosedOn` verdadeiro no primeiro e no último dia e falso no dia seguinte; `endDate < startDate` dá `validation`; profissional não cria.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: equipe, expediente, bloqueios e fechamentos`.

---

### Task 6: Clientes

**Files:**
- Create: `src/server/domain/customers/contact.ts`, `src/server/domain/customers/customers.ts`
- Modify: `tests/setup/factories.ts` (`makeCustomer`)
- Test: `tests/unit/contact.test.ts`, `tests/integration/customers.test.ts`

**Interfaces:**
- Produces:

```ts
// customers/contact.ts (puro)
export function normalizeEmail(input: string): string                 // trim + minúsculas; inválido → RangeError
export function normalizePhone(input: string): string                 // só dígitos, com DDI; ver regras; inválido → RangeError
export function formatPhone(digits: string): string                   // '5511912345678' → '(11) 91234-5678'; outros países → '+' + dígitos
// customers/customers.ts
export type CustomerView = { id: string; name: string; email: string | null; phone: string | null; phoneLabel: string | null;
  avatarUrl: string | null; birthDate: string | null; notes: string | null; isClubMember: boolean; origin: 'APP' | 'PANEL';
  hasAppAccess: boolean; archived: boolean; createdAt: Date }
export type CustomerInput = { name: string; email?: string | null; phone?: string | null; birthDate?: string | null; notes?: string | null; isClubMember?: boolean }
export function listCustomers(ctx: TenantContext, q?: { search?: string; clubOnly?: boolean; includeArchived?: boolean; cursor?: string; limit?: number }):
  Promise<{ items: CustomerView[]; nextCursor: string | null }>      // ordena por nome, id; limit padrão 30, máximo 100
export function getCustomer(ctx: TenantContext, id: string): Promise<CustomerView>
export function createCustomer(ctx: TenantContext, input: CustomerInput): Promise<CustomerView>
export function updateCustomer(ctx: TenantContext, id: string, input: Partial<CustomerInput>): Promise<CustomerView>
export function archiveCustomer(ctx: TenantContext, id: string): Promise<void>
export function restoreCustomer(ctx: TenantContext, id: string): Promise<CustomerView>
export function anonymizeCustomer(ctx: TenantContext, id: string): Promise<void>
```

Regras de telefone: remove tudo que não é dígito; se começar com `00`, tira; 10 ou 11 dígitos (DDD + número) ganham `55` na frente; com `+` ou já com DDI, mantém; resultado com 10 a 15 dígitos, senão erro "Informe o telefone com DDD, por exemplo (11) 91234-5678.". Regras de cliente: `name` 1 a 120; `notes` até 2000; `birthDate` data válida não futura (no fuso da conta, por `ctx.clock()`); e-mail único por conta entre clientes (duplicado → `conflict`, `reason: 'email_taken'`, campo `email`). Ler exige `view_clients`; criar, alterar, arquivar e restaurar exigem `manage_clients`; `notes` e `isClubMember` só mudam com `manage_clients`. Ator `customer` só lê e altera o próprio cadastro (`name`, `email`, `phone`, `birthDate`), nunca `notes` nem `isClubMember`, e nunca lista. `search` casa por nome (sem diferenciar maiúsculas e acentos, se a extensão `unaccent` existir; senão só maiúsculas), por e-mail e por dígitos do telefone. `anonymizeCustomer` (dono do cadastro ou `manage_clients`): nome vira "Cliente removido", zera e-mail, telefone, senha, avatar, data de nascimento e observações, marca `anonymizedAt` e `archivedAt`; os agendamentos continuam ligados; é idempotente; grava auditoria sem os dados apagados. `CustomerView.notes` vem `null` para ator `customer`.

- [ ] **Step 1: Testes que falham.** `tests/unit/contact.test.ts`:

```ts
test('telefone em formatos soltos vira a mesma forma', () => {
  for (const raw of ['(11) 91234-5678', '11912345678', '+55 11 91234-5678', '0055 11 91234 5678', ' 11 9 1234.5678 '])
    expect(normalizePhone(raw)).toBe('5511912345678')
  expect(normalizePhone('(11) 3123-4567')).toBe('551131234567')
  expect(normalizePhone('+351 912 345 678')).toBe('351912345678')
})
test('telefone curto, vazio ou longo demais é recusado com orientação', () => {
  for (const bad of ['', '91234-5678', '123', '1'.repeat(16)]) expect(() => normalizePhone(bad)).toThrow(/DDD/)
})
test('e-mail', () => {
  expect(normalizeEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com')
  for (const bad of ['', 'ana', 'ana@', '@x.com', 'a b@x.com']) expect(() => normalizeEmail(bad)).toThrow(RangeError)
})
test('rótulo de telefone', () => {
  expect(formatPhone('5511912345678')).toBe('(11) 91234-5678')
  expect(formatPhone('551131234567')).toBe('(11) 3123-4567')
  expect(formatPhone('351912345678')).toBe('+351912345678')
})
```

`tests/integration/customers.test.ts`: cria com telefone `(11) 91234-5678` e lê `phone '5511912345678'` e `phoneLabel '(11) 91234-5678'`; e-mail repetido na conta dá `conflict` com `fields.email`; o mesmo e-mail em outra conta é aceito; busca por "ana", por "ANA", por parte do e-mail e por "91234" acha a cliente; paginação com `limit: 2` sobre 5 clientes percorre todos sem repetir nem pular; profissional lista mas não cria; `notes` não aparece para o ator `customer`; cliente A não lê o cadastro do cliente B (`forbidden`) e não lista; cliente altera o próprio telefone, e `isClubMember` ou `notes` vindos dele são recusados com `forbidden` sem alterar nada; `birthDate` amanhã dá `validation`; arquivado some da lista; `anonymizeCustomer` zera os campos, mantém um agendamento existente ligado ao cliente e pode ser chamado duas vezes; cliente de outra conta dá `not_found`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: clientes com contato normalizado e anonimização`.

---

### Task 7: Núcleo puro de horários livres

**Files:**
- Create: `src/server/domain/scheduling/slots.ts`
- Modify: `package.json` (`test:tz` inclui `tests/unit/slots.test.ts`)
- Test: `tests/unit/slots.test.ts`

**Interfaces:**
- Consumes: `minuteToInstant`, `addMinutes`, `minutesBetween` do módulo de tempo.
- Produces (tudo puro, sem banco e sem relógio):

```ts
export type Interval = { start: Date; end: Date }                       // fim exclusivo
export function overlaps(a: Interval, b: Interval): boolean             // encostar não é sobrepor
export function computeSlots(i: {
  date: string; timeZone: string
  workingRanges: { startMin: number; endMin: number }[]
  busy: Interval[]            // agendamentos ativos: recebem a folga (bufferMin) dos dois lados
  blocked: Interval[]         // bloqueios e fechamentos: sem folga
  durationMin: number; stepMin: number; bufferMin: number
  notBefore: Date             // primeiro início permitido (agora + antecedência)
  notAfter: Date              // último instante permitido para o INÍCIO (exclusivo)
}): Date[]                    // inícios possíveis, em ordem, sem repetição
export function fitsWorkingHours(i: { start: Date; end: Date; date: string; timeZone: string; workingRanges: { startMin: number; endMin: number }[] }): boolean
```

Algoritmo de `computeSlots`: para cada intervalo de expediente, os candidatos são os minutos locais `m` múltiplos de `stepMin` (grade presa ao relógio: 00:00 + k·passo) com `startMin <= m` e `m + durationMin <= endMin`; cada `m` vira instante por `minuteToInstant`; o candidato `[início, início + duração)` é aceito se: cabe no intervalo do expediente em instantes (`início >= instante(startMin)` e `fim <= instante(endMin)`), `início >= notBefore`, `início < notAfter`, não sobrepõe nenhum `blocked`, e não sobrepõe nenhum `busy` alargado em `bufferMin` para cada lado. Remove repetidos (horário de verão) e ordena.

- [ ] **Step 1: Teste que falha:**

```ts
const SP = 'America/Sao_Paulo'
const z = (s: string) => new Date(s)
const labels = (ds: Date[]) => ds.map((d) => d.toISOString().slice(11, 16))   // UTC HH:mm
const base = { date: '2026-11-16', timeZone: SP, workingRanges: [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1080 }],
  busy: [], blocked: [], durationMin: 60, stepMin: 30, bufferMin: 0, notBefore: z('2026-01-01T00:00:00Z'), notAfter: z('2027-01-01T00:00:00Z') }

test('dia livre: 5 inícios de manhã e 9 à tarde', () => {
  const s = computeSlots(base)
  expect(s).toHaveLength(14)
  expect(s[0]!.toISOString()).toBe('2026-11-16T12:00:00.000Z')      // 09:00 local
  expect(s[4]!.toISOString()).toBe('2026-11-16T14:00:00.000Z')      // 11:00 local
  expect(s[5]!.toISOString()).toBe('2026-11-16T16:00:00.000Z')      // 13:00 local
  expect(s[13]!.toISOString()).toBe('2026-11-16T20:00:00.000Z')     // 17:00 local
})
test('agendamento das 10:00 às 11:00 tira 09:30, 10:00 e 10:30', () => {
  const s = computeSlots({ ...base, busy: [{ start: z('2026-11-16T13:00:00Z'), end: z('2026-11-16T14:00:00Z') }] })
  expect(labels(s).slice(0, 2)).toEqual(['12:00', '14:00'])          // 09:00 e 11:00 locais
  expect(s).toHaveLength(11)
})
test('folga de 15 min dos dois lados esvazia a manhã', () => {
  const s = computeSlots({ ...base, bufferMin: 15, busy: [{ start: z('2026-11-16T13:00:00Z'), end: z('2026-11-16T14:00:00Z') }] })
  expect(s[0]!.toISOString()).toBe('2026-11-16T16:00:00.000Z')
  expect(s).toHaveLength(9)
})
test('bloqueio não recebe folga', () => {
  const s = computeSlots({ ...base, bufferMin: 15, blocked: [{ start: z('2026-11-16T13:00:00Z'), end: z('2026-11-16T14:00:00Z') }] })
  expect(labels(s).slice(0, 2)).toEqual(['12:00', '14:00'])
})
test('antecedência corta os inícios anteriores', () => {
  const s = computeSlots({ ...base, notBefore: z('2026-11-16T13:10:00Z') })   // 10:10 local
  expect(s[0]!.toISOString()).toBe('2026-11-16T13:30:00.000Z')               // 10:30 local
})
test('janela máxima corta os inícios a partir dela', () => {
  expect(computeSlots({ ...base, notAfter: z('2026-11-16T12:00:00Z') })).toEqual([])
  expect(computeSlots({ ...base, notAfter: z('2026-11-16T12:30:00Z') })).toHaveLength(1)
})
test('grade presa ao relógio, não ao início do expediente', () => {
  const s = computeSlots({ ...base, workingRanges: [{ startMin: 550, endMin: 720 }], durationMin: 30, stepMin: 15 })
  expect(s[0]!.toISOString()).toBe('2026-11-16T12:15:00.000Z')      // 09:15 local
})
test('expediente até a meia-noite: o serviço precisa caber inteiro', () => {
  const s = computeSlots({ ...base, workingRanges: [{ startMin: 1320, endMin: 1440 }] })   // 22:00 a 24:00, 60 min, passo 30
  expect(s.map((d) => d.toISOString())).toEqual(['2026-11-17T01:00:00.000Z', '2026-11-17T01:30:00.000Z', '2026-11-17T02:00:00.000Z'])
})
test('duração maior que o expediente: nenhum horário', () => {
  expect(computeSlots({ ...base, workingRanges: [{ startMin: 540, endMin: 570 }] })).toEqual([])
})
test('sem expediente: nenhum horário', () => {
  expect(computeSlots({ ...base, workingRanges: [] })).toEqual([])
})
test('início do horário de verão em Nova York: a hora inexistente não gera repetidos', () => {
  const s = computeSlots({ ...base, date: '2026-03-08', timeZone: 'America/New_York', workingRanges: [{ startMin: 60, endMin: 240 }], durationMin: 30 })
  expect(s.map((d) => d.toISOString())).toEqual(['2026-03-08T06:00:00.000Z', '2026-03-08T06:30:00.000Z', '2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00.000Z'])
})
test('fim do horário de verão em Nova York: a hora repetida aparece uma vez', () => {
  const s = computeSlots({ ...base, date: '2026-11-01', timeZone: 'America/New_York', workingRanges: [{ startMin: 0, endMin: 180 }], stepMin: 60 })
  expect(s.map((d) => d.toISOString())).toEqual(['2026-11-01T04:00:00.000Z', '2026-11-01T05:00:00.000Z', '2026-11-01T07:00:00.000Z'])
})
test('overlaps: encostar não conta', () => {
  const a = { start: z('2026-11-16T12:00:00Z'), end: z('2026-11-16T13:00:00Z') }
  expect(overlaps(a, { start: z('2026-11-16T13:00:00Z'), end: z('2026-11-16T14:00:00Z') })).toBe(false)
  expect(overlaps(a, { start: z('2026-11-16T12:59:00Z'), end: z('2026-11-16T14:00:00Z') })).toBe(true)
})
test('fitsWorkingHours', () => {
  const w = { date: '2026-11-16', timeZone: SP, workingRanges: base.workingRanges }
  expect(fitsWorkingHours({ ...w, start: z('2026-11-16T14:00:00Z'), end: z('2026-11-16T15:00:00Z') })).toBe(true)    // 11:00–12:00
  expect(fitsWorkingHours({ ...w, start: z('2026-11-16T14:30:00Z'), end: z('2026-11-16T15:30:00Z') })).toBe(false)   // invade o almoço
})
```

(O arquivo de teste fica em `tests/`, onde `toISOString` é permitido pelo lint.)

- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA; `npm run test:tz` → PASSA nos três fusos.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: cálculo puro de horários livres`.

---

### Task 8: Disponibilidade

**Files:**
- Create: `src/server/domain/scheduling/availability.ts`
- Modify: `tests/setup/factories.ts` (`makeAppointment`: cria agendamento direto pelo `prisma` cru com itens)
- Test: `tests/integration/availability.test.ts`

**Interfaces:**
- Consumes: `computeSlots`, `getSchedulingRules`, `isClosedOn`, modelos da Tarefa 2.
- Produces:

```ts
export type SlotView = { startsAt: Date; label: string; professionalIds: string[] }   // label 'HH:mm' no fuso da conta
export type AvailabilityView = { date: string; durationMin: number; totalCents: number; slots: SlotView[] }
export function getAvailability(ctx: TenantContext, q: { date: string; serviceIds: string[]; professionalId?: string | null }): Promise<AvailabilityView>
export function loadDayOccupancy(ctx: TenantContext, q: { professionalIds: string[]; date: string; ignoreAppointmentId?: string }):
  Promise<Map<string, { workingRanges: { startMin: number; endMin: number }[]; busy: Interval[]; blocked: Interval[] }>>
export function resolveServices(ctx: TenantContext, serviceIds: string[]): Promise<{ items: ServiceView[]; durationMin: number; totalCents: number }>
```

Regras: `date` válida; `serviceIds` de 1 a 10, sem repetidos, todos serviços ativos e não arquivados da conta (senão `validation` no campo `serviceIds`); soma das durações de até 720 min; serviço `clubOnly` exige ator de equipe ou cliente com `isClubMember` (senão `forbidden`, `reason: 'club_only'`). Profissionais candidatos: ativos, não arquivados e que fazem todos os serviços; se `professionalId` veio e não é candidato → `validation`. Dia fechado (`isClosedOn`) → lista vazia. `busy` = agendamentos `PENDING`, `CONFIRMED` e `COMPLETED` do profissional que tocam o dia local; `blocked` = bloqueios que tocam o dia. `notBefore = ctx.clock() + minLeadMin`; `notAfter` = fim do dia local `hoje + maxAdvanceDays`. Para ator de equipe (member, impersonator), `notBefore = ctx.clock()` (sem antecedência mínima) e `notAfter` sem limite de janela (use um ano). Cada início aparece uma vez, com a lista dos profissionais livres nele, ordenada por `displayOrder`, nome.

- [ ] **Step 1: Testes que falham** (conta em `America/Sao_Paulo`, relógio fixo `2026-11-16T11:00:00Z` = 08:00 local de uma segunda; dois profissionais com expediente 09:00–12:00 e 13:00–18:00 na segunda; serviço "Banho" 60 min R$ 80,00 e "Tosa" 30 min R$ 50,00; grade de 30): com ator `customer`, `getAvailability({ date: '2026-11-16', serviceIds: [banho] })` começa às 09:00 (`label '09:00'`, antecedência de 60 min a partir das 08:00) com os dois profissionais e `durationMin 60`, `totalCents 8000`; com `[banho, tosa]` a duração é 90 e o total 13000, e o último início da manhã é 10:30; um agendamento confirmado do profissional A às 10:00 tira A dos inícios 09:30, 10:00 e 10:30 mas B continua neles; com `professionalId: A` esses inícios somem; bloqueio de A a tarde inteira deixa só B à tarde; dia fechado devolve `slots: []`; domingo sem expediente devolve `[]`; data além de `maxAdvanceDays` devolve `[]` para cliente e devolve horários para gerente; relógio às 10:10 locais, serviço de 60 min: o cliente (antecedência de 60 min → a partir de 11:10) tem o primeiro início às 13:00, porque 11:30 não cabe antes do almoço; o gerente tem o primeiro início às 10:30; serviço inativo, repetido, de outra conta ou lista vazia → `validation` com `fields.serviceIds`; `clubOnly` com cliente comum → `forbidden`, com cliente do clube → horários; profissional que não faz a tosa não aparece para `[banho, tosa]`; conta em `America/Manaus` com o mesmo expediente devolve o início das 09:00 como `2026-11-16T13:00:00.000Z`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: disponibilidade por serviços e profissional`.

---

### Task 9: Agendamentos — marcar, remarcar, cancelar e situação

**Files:**
- Create: `src/server/domain/scheduling/status.ts`, `src/server/domain/scheduling/appointments.ts`
- Modify: `src/server/db/tenant.ts` (`$lockKey`)
- Test: `tests/unit/appointment-status.test.ts`, `tests/integration/appointments.test.ts`, `tests/integration/appointments-concurrency.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 8.
- Produces:

```ts
// db/tenant.ts — único SQL cru alcançável por tenantDb
// dentro de uma transação interativa do cliente da conta:
//   await tx.$lockKey('professional', professionalId)
// executa pg_advisory_xact_lock(hashtextextended(businessId || ':' || scope || ':' || id, 0)); fora de transação, lança TenantViolationError.
// scheduling/status.ts (puro)
export const ACTIVE_STATUSES: readonly AppointmentStatus[]            // PENDING, CONFIRMED, COMPLETED
export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean
// permitido: PENDING→CONFIRMED, PENDING→CANCELED, CONFIRMED→CANCELED, CONFIRMED→COMPLETED, CONFIRMED→NO_SHOW,
//            COMPLETED→CONFIRMED (desfazer), NO_SHOW→CONFIRMED (desfazer). Nada mais.
// scheduling/appointments.ts
export type AppointmentView = {
  id: string; status: AppointmentStatus; source: 'APP' | 'PANEL'
  startsAt: Date; endsAt: Date; local: { date: string; start: string; end: string }     // rótulos no fuso da conta
  customer: { id: string; name: string; phoneLabel: string | null }
  professional: { id: string; name: string }
  items: { serviceId: string; name: string; priceCents: number; durationMin: number }[]
  totalCents: number; totalDurationMin: number; commissionCents: number | null; notes: string | null
  canceledAt: Date | null; cancelReason: string | null; completedAt: Date | null
}
export function bookAppointment(ctx: TenantContext, i: { customerId?: string; professionalId?: string | null; serviceIds: string[]; startsAt: Date; notes?: string | null }): Promise<AppointmentView>
export function rescheduleAppointment(ctx: TenantContext, id: string, i: { startsAt: Date; professionalId?: string | null; serviceIds?: string[] }): Promise<AppointmentView>
export function cancelAppointment(ctx: TenantContext, id: string, i?: { reason?: string | null }): Promise<AppointmentView>
export function confirmAppointment(ctx: TenantContext, id: string): Promise<AppointmentView>
export function completeAppointment(ctx: TenantContext, id: string): Promise<AppointmentView>
export function markNoShow(ctx: TenantContext, id: string): Promise<AppointmentView>
export function undoOutcome(ctx: TenantContext, id: string): Promise<AppointmentView>      // COMPLETED/NO_SHOW → CONFIRMED
export function adjustAppointment(ctx: TenantContext, id: string, i: { serviceIds?: string[]; totalCents?: number; notes?: string | null }): Promise<AppointmentView>
export function getAppointment(ctx: TenantContext, id: string): Promise<AppointmentView>
// db/tenant.ts
export type TenantTx   // o cliente recebido pelo callback de ctx.db.$transaction(async (tx) => …): mesmas regras de conta, mais $lockKey
```

Regras comuns: `serviceIds` validados por `resolveServices`; `endsAt = startsAt + soma das durações`; itens gravados com nome, preço, duração e pontos copiados, na ordem pedida. A marcação e toda mudança de horário, profissional ou itens rodam em `ctx.db.$transaction`: `tx.$lockKey('professional', id)` → recarrega a ocupação → valida → grava. A violação da restrição `appointments_no_overlap` (SQLSTATE 23P01) vira `DomainError('conflict', 'Esse horário acabou de ser ocupado. Escolha outro.', { reason: 'slot_taken', details: { nearest } })`, com até 3 próximos inícios livres do mesmo dia (melhor esforço; lista vazia se não der). Se `$lockKey` não puder ser implementado com o Prisma 7 instalado, PARE e reporte BLOCKED com o que tentou.

Quem é o cliente: ator `customer` marca para si (`customerId` omitido ou igual ao dele; outro → `forbidden`); equipe informa `customerId` de cliente não arquivado da conta. Fonte: `APP` para ator `customer`, `PANEL` para equipe.

Regras do cliente (ator `customer`): o início precisa ser um dos devolvidos por `getAvailability` para aquela data, serviços e profissional (senão `conflict`, `reason: 'slot_unavailable'`); situação inicial `CONFIRMED` se `autoConfirm`, senão `PENDING`; cancelar e remarcar só os próprios, só `PENDING`/`CONFIRMED`, e só até `customerChangeWindowMin` antes do início (senão `conflict`, `reason: 'too_late'`, com mensagem que diz o prazo); não confirma, não conclui, não ajusta.

Regras da equipe: exige `view_all_agendas` para agir sobre agenda de outro profissional; o papel `PROFESSIONAL` só age sobre agendamentos do profissional ligado a ele (`ownProfessionalId`), senão `forbidden`. Pode marcar fora da grade, da antecedência, do expediente e em dia fechado; nunca sobre outro agendamento ativo (`slot_taken`) nem sobre um bloqueio do profissional (`conflict`, `reason: 'blocked'`); a folga (`bufferMin`) não se aplica à equipe. Situação inicial sempre `CONFIRMED`. `professionalId` nulo ou omitido ("qualquer um"): escolhe, entre os candidatos livres naquele horário, o de menos agendamentos ativos no dia local; empate por `displayOrder`, depois `id`; nenhum livre → `slot_taken`.

Situação: transição inválida → `conflict`, `reason: 'invalid_transition'`. `completeAppointment` e `markNoShow` exigem `ctx.clock() >= startsAt` (senão `conflict`, `reason: 'too_early'`). Concluir grava `completedAt` e `commissionCents = Math.round(totalCents × commissionBps do profissional ÷ 10000)`; desfazer limpa os dois. Cancelar grava `canceledAt`, `canceledByType`, `canceledById` e `cancelReason` (até 300 caracteres). `adjustAppointment` (equipe, só `PENDING`/`CONFIRMED`): trocar `serviceIds` refaz itens, total e `endsAt` (revalida sobreposição); `totalCents` informado substitui o total calculado (0 a 10.000.000); `notes` até 2000. Remarcar mantém o mesmo `id`. Toda mudança grava auditoria (`appointment.booked`, `.rescheduled`, `.canceled`, `.confirmed`, `.completed`, `.no_show`, `.outcome_undone`, `.adjusted`). Ler: equipe conforme a regra de agenda acima; cliente só os próprios (outro → `not_found`).

- [ ] **Step 1: Testes que falham.** `tests/unit/appointment-status.test.ts`: tabela completa das 25 combinações de `canTransition`, verdadeira só nas 7 listadas. `tests/integration/appointments.test.ts` (mesma montagem da Tarefa 8, relógio 08:00 locais): cliente marca 10:00 com `[banho]` → `CONFIRMED`, `source 'APP'`, `local { date: '2026-11-16', start: '10:00', end: '11:00' }`, `startsAt 2026-11-16T13:00:00.000Z`, um item com nome e preço copiados, `totalCents 8000`; alterar o preço do serviço depois não muda o agendamento; com `autoConfirm: false` nasce `PENDING`; cliente marcando 10:10 (fora da grade) ou 08:30 (antes da antecedência) recebe `slot_unavailable`; gerente marca 10:10 e 07:00 (fora do expediente) com sucesso; gerente sobre agendamento existente recebe `slot_taken` com `details.nearest` contendo instantes; gerente sobre bloqueio recebe `blocked`; lista de serviços vazia, repetida, com serviço arquivado, inativo ou de outra conta, e profissional que não faz o serviço → `validation` e nada gravado (`count` continua 0); "qualquer profissional" escolhe o de menos agendamentos no dia e, no empate, o de menor `displayOrder`; cliente A não cancela nem lê o agendamento do cliente B; cliente cancela com 3 h de antecedência e é barrado com 1 h (`too_late`, janela de 120 min); remarcar mantém o `id`, muda horários e, com `serviceIds`, refaz itens e total; remarcar para o próprio horário atual funciona (o agendamento não conflita consigo mesmo); `completeAppointment` antes do início dá `too_early`; depois, com profissional de `commissionBps 4500` e total 8000, grava `commissionCents 3600`; `undoOutcome` volta a `CONFIRMED` com `commissionCents` e `completedAt` nulos; `markNoShow` libera o horário para outra marcação; `cancel` de `COMPLETED` dá `invalid_transition`; `adjustAppointment` com `totalCents: 6000` muda só o total; com `[banho, tosa]` estende `endsAt` e é recusado (`slot_taken`) se invadir o próximo agendamento; papel `PROFESSIONAL` age no próprio agendamento e recebe `forbidden` no de um colega; agendamento de outra conta → `not_found`; cada operação deixa a linha de auditoria correspondente. `tests/integration/appointments-concurrency.test.ts`: 20 `bookAppointment` em paralelo (`Promise.allSettled`) para o mesmo profissional e horário, com 20 clientes diferentes → exatamente 1 cumprida e 19 rejeitadas com `reason === 'slot_taken'`, e o banco tem 1 agendamento; o mesmo pedido idêntico enviado 2 vezes em paralelo (mesmo cliente) → 1 agendamento; 10 marcações em paralelo para horários diferentes e sem sobreposição → 10 cumpridas; "qualquer profissional" com 2 profissionais e 3 pedidos paralelos no mesmo horário → 2 cumpridas, em profissionais diferentes, e 1 `slot_taken`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA. Rode o arquivo de concorrência 5 vezes seguidas; precisa passar nas 5.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: agendamentos com trava por profissional e máquina de situações`.

---

### Task 10: Fila de avisos

**Files:**
- Create: `src/server/domain/settings/notification-settings.ts`, `src/server/domain/notifications/outbox.ts`
- Modify: `src/server/domain/scheduling/appointments.ts` (chama a fila dentro da mesma transação)
- Test: `tests/unit/notification-settings.test.ts`, `tests/integration/outbox.test.ts`

**Interfaces:**
- Produces:

```ts
// settings/notification-settings.ts
export type ChannelToggle = { email: boolean; push: boolean }
export type NotificationSettings = Record<NotificationKind, ChannelToggle>
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings        // tudo ligado
export function resolveNotificationSettings(raw: unknown): NotificationSettings   // mescla com os padrões; ignora chaves e tipos desconhecidos
export function getNotificationSettings(ctx: TenantContext): Promise<NotificationSettings>
export function updateNotificationSettings(ctx: TenantContext, patch: Partial<Record<NotificationKind, Partial<ChannelToggle>>>): Promise<NotificationSettings>  // manage_settings
// notifications/outbox.ts
export type AppointmentEvent = 'booked' | 'canceled' | 'rescheduled' | 'completed' | 'outcome_undone' | 'no_show'
export function enqueueAppointmentEvent(tx: TenantTx, ctx: TenantContext, event: AppointmentEvent,
  appt: { id: string; customerId: string; professionalId: string; startsAt: Date; status: AppointmentStatus }, opts?: { previousStartsAt?: Date }): Promise<void>
export function notifyProfessionalFreeEarly(ctx: TenantContext, appointmentId: string): Promise<void>
```

Regras por evento (uma linha por canal ligado nas configurações da conta; `scheduledFor = ctx.clock()` salvo indicação):
- `booked`: cliente recebe `APPOINTMENT_CONFIRMED`; se o agendamento veio do app (ator `customer`), o membro ligado ao profissional recebe `STAFF_NEW_APPOINTMENT`; lembretes `APPOINTMENT_REMINDER_24H` (`startsAt − 24 h`) e `APPOINTMENT_REMINDER_1H` (`startsAt − 60 min`), cada um criado só se o horário de envio ainda está no futuro e se o agendamento está `CONFIRMED` ou `PENDING`.
- `canceled`: lembretes `PENDING` do agendamento viram `CANCELED`; se a equipe cancelou, o cliente recebe `APPOINTMENT_CANCELED`; se o cliente cancelou, o membro do profissional recebe `STAFF_APPOINTMENT_CANCELED`.
- `rescheduled`: lembretes `PENDING` antigos viram `CANCELED` e novos são criados; equipe remarcou → cliente recebe `APPOINTMENT_RESCHEDULED`; cliente remarcou → membro recebe `STAFF_APPOINTMENT_RESCHEDULED`. `payload.previousStartsAt` guarda o instante anterior (texto ISO, gerado por `toIsoInstant`).
- `completed`: lembretes `PENDING` viram `CANCELED`; cliente recebe `APPOINTMENT_COMPLETED`.
- `no_show`: lembretes `PENDING` viram `CANCELED`. `outcome_undone`: nada.
- `notifyProfessionalFreeEarly` (equipe; agendamento `CONFIRMED` do dia local de hoje, ainda não iniciado): cliente recebe `PROFESSIONAL_FREE_EARLY`; no máximo uma vez por agendamento.
- Profissional sem `membershipId` não gera aviso de equipe. Cliente anonimizado ou arquivado não recebe nada.
- `dedupeKey`: `${kind}:${channel}:${appointmentId}:${epochMs de startsAt}` para confirmação, lembretes e remarcação; `${kind}:${channel}:${appointmentId}` para os demais. Linha repetida é ignorada sem erro (idempotente).
- `payload` guarda só identificadores e instantes (`appointmentId`, `startsAt` ISO). O texto do aviso é montado no envio (Fase 2B).
- As preferências do próprio cliente (`notify*`) são avaliadas no envio, não aqui.

- [ ] **Step 1: Testes que falham.** `tests/unit/notification-settings.test.ts`: `resolveNotificationSettings({})` é igual aos padrões; `{ APPOINTMENT_CONFIRMED: { email: false } }` desliga só o e-mail desse tipo; lixo (`null`, `'x'`, `{ FOO: { email: false } }`, `{ APPOINTMENT_CONFIRMED: { email: 'não' } }`) é ignorado. `tests/integration/outbox.test.ts` (relógio fixo): marcar pelo cliente com 3 dias de antecedência cria confirmação (e-mail e push) para o cliente, aviso de equipe (e-mail e push) para o membro do profissional e os dois lembretes com `scheduledFor` exatos; marcar para daqui a 2 h cria só o lembrete de 1 h; para daqui a 30 min, nenhum lembrete; marcar pela equipe não cria aviso de equipe; com o e-mail de confirmação desligado na conta, só a linha de push existe; cancelar pela equipe cancela os lembretes pendentes e cria `APPOINTMENT_CANCELED` para o cliente; cancelar pelo cliente cria `STAFF_APPOINTMENT_CANCELED`; remarcar cancela os lembretes antigos, cria os novos com o horário novo e guarda `previousStartsAt`; concluir cria `APPOINTMENT_COMPLETED`; profissional sem vínculo não gera aviso de equipe; chamar `enqueueAppointmentEvent` duas vezes com o mesmo evento não duplica linhas; uma marcação que falha (por `slot_taken`) não deixa nenhuma linha na fila (mesma transação); `notifyProfessionalFreeEarly` duas vezes cria um aviso só; gerente altera as configurações e profissional não.
- [ ] **Step 2:** Rodar → FALHA. Implementar e ligar em `appointments.ts`. Rodar → PASSA (inclusive os testes da Tarefa 9).
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: fila de avisos ligada ao ciclo do agendamento`.

---

### Task 11: Consultas de agenda

**Files:**
- Create: `src/server/domain/scheduling/agenda.ts`
- Test: `tests/integration/agenda.test.ts`

**Interfaces:**
- Produces:

```ts
export type AgendaDay = { date: string; weekday: Weekday; closed: boolean; closureReason: string | null
  professionals: { id: string; name: string; workingRanges: { startMin: number; endMin: number; startLabel: string; endLabel: string }[]
    appointments: AppointmentView[]; blocks: (TimeBlockView & { local: { start: string; end: string } })[] }[] }
export function getAgenda(ctx: TenantContext, q: { from: string; to: string; professionalId?: string | null; includeCanceled?: boolean }): Promise<AgendaDay[]>
export function listCustomerAppointments(ctx: TenantContext, q: { customerId?: string; scope: 'upcoming' | 'past'; cursor?: string; limit?: number }):
  Promise<{ items: AppointmentView[]; nextCursor: string | null }>
export function getNextAppointment(ctx: TenantContext, customerId?: string): Promise<AppointmentView | null>
export function getDaySummary(ctx: TenantContext, date: string, professionalId?: string | null):
  Promise<{ total: number; byStatus: Record<AppointmentStatus, number>; bookedMinutes: number; workingMinutes: number; revenueCents: number }>
```

Regras: `from <= to`, no máximo 31 dias. `getAgenda` é da equipe (`view_own_agenda`); o papel `PROFESSIONAL` vê só a própria ficha (qualquer `professionalId` diferente → `forbidden`; omitido → a própria); quem tem `view_all_agendas` vê todos os profissionais ativos (ou o pedido), ordenados por `displayOrder`, nome. Um agendamento aparece no dia local em que começa. Cancelados só com `includeCanceled`. Bloqueio que atravessa dias aparece em cada dia que toca, com rótulos recortados ao dia (`'00:00'`/`'24:00'` nas bordas). `listCustomerAppointments`: equipe com `view_clients` informa `customerId`; ator `customer` vê os próprios; `upcoming` = `startsAt >= ctx.clock()` e situação `PENDING`/`CONFIRMED`, em ordem crescente; `past` = o restante, em ordem decrescente; `limit` padrão 20, máximo 50. `getDaySummary`: `revenueCents` soma `totalCents` dos `COMPLETED`; `bookedMinutes` soma as durações dos ativos; `workingMinutes` soma o expediente do dia dos profissionais considerados (0 em dia fechado).

- [ ] **Step 1: Testes que falham:** semana de 2026-11-16 a 2026-11-22 devolve 7 dias com `weekday` certos; agendamento às 23:30 locais de segunda (`2026-11-17T02:30Z`) aparece na segunda, não na terça; em conta de `America/Manaus` o mesmo instante aparece na segunda às 22:30; dia fechado vem com `closed: true` e o motivo; bloqueio de segunda 22:00 a terça 02:00 aparece nos dois dias com rótulos `22:00–24:00` e `00:00–02:00`; cancelado só aparece com `includeCanceled`; profissional vê só a própria coluna e recebe `forbidden` ao pedir a de um colega; gerente vê as duas colunas na ordem de `displayOrder`; intervalo de 32 dias dá `validation`; `listCustomerAppointments` separa próximos e passados em relação ao relógio e pagina sem repetir; cliente não lê os de outro cliente; `getNextAppointment` devolve o mais próximo confirmado e `null` quando não há; `getDaySummary` com 2 confirmados (60 e 30 min), 1 concluído de 60 min e R$ 80,00 e 1 cancelado devolve `total 4`, `byStatus` com `CONFIRMED 2`, `COMPLETED 1`, `CANCELED 1` e os demais 0, `bookedMinutes 150`, `revenueCents 8000`, e `workingMinutes` igual à soma do expediente do dia dos profissionais considerados.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Rodar → PASSA.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm test` → verde. Commit: `feat: consultas de agenda por dia, semana e cliente`.

---

### Task 12: Dados de demonstração e verificação da fase

**Files:**
- Modify: `prisma/seed-data.ts`, `prisma/seed.ts`, `tests/integration/seed.test.ts`, `package.json` (`test:tz` roda `tests/unit/time.test.ts`, `time-extra.test.ts` e `slots.test.ts`)
- Test: `tests/integration/seed.test.ts`

**Interfaces:**
- Consumes: as funções de domínio das Tarefas 4 a 9 (o seed cria os dados pelo domínio, com `createTenantContext` e ator `system`... se alguma função exigir capacidade que `system` não tem, o seed usa um ator `impersonator` nomeado "Seed"; não escreva pelo `prisma` cru o que o domínio sabe criar).

O seed passa a criar, em cada conta de demonstração, de forma idempotente (se a conta já tem serviços, não cria nada da agenda de novo):
- **Patas & Cia** (`America/Sao_Paulo`): serviços Banho (60 min, R$ 70,00), Tosa higiênica (30, R$ 45,00), Banho e tosa completa (120, R$ 140,00), Corte de unhas (15, R$ 25,00), Hidratação (30, R$ 55,00, só clube); 3 profissionais (os dois usuários de papel profissional/gerente existentes ligados por `membershipId`, mais uma sem acesso), comissão de 40%; expediente de segunda a sábado 08:00–12:00 e 13:00–18:00 (sábado só 08:00–13:00); 12 clientes com nomes plausíveis, telefones válidos e 3 no clube.
- **Navalha de Ouro** (`America/Manaus`): Corte (30, R$ 50,00), Barba (30, R$ 40,00), Corte e barba (60, R$ 80,00), Sobrancelha (15, R$ 20,00), Pigmentação (45, R$ 90,00); 3 profissionais, comissão de 45%; terça a sábado 09:00–20:00, com intervalo 12:00–13:00; 12 clientes.
- Em cada conta, agendamentos relativos ao dia em que o seed roda (no fuso da conta): 6 concluídos ontem, 8 hoje (mistura de concluídos, confirmados e um que faltou, conforme a hora), 5 amanhã, 3 espalhados na semana seguinte, 1 cancelado; um bloqueio amanhã à tarde para um profissional; um fechamento num dia da semana seguinte ("Feriado"). Nenhum agendamento cai fora do expediente, e nenhum se sobrepõe. Os do passado são gravados com um relógio injetado no passado (por isso `ctx.clock`), não burlando as regras. Quando "ontem", "hoje" ou "amanhã" cai num dia sem expediente da conta, usa-se o dia útil anterior (para o passado) ou o seguinte (para o futuro); hoje sem expediente fica sem agendamentos e os 8 vão para o dia útil seguinte. A função passa a ser `seed(prisma, env, opts?: { now?: Date })`.

- [ ] **Step 1: Teste que falha** (estende `seed.test.ts`): depois do seed com relógio fixo `2026-11-18T15:00:00Z` (quarta), cada conta tem 5 serviços, 3 profissionais, 12 clientes, 23 agendamentos; rodar o seed de novo não muda as contagens; nenhum par de agendamentos ativos do mesmo profissional se sobrepõe (consulta); todo agendamento ativo cabe no expediente do profissional (`fitsWorkingHours`); a fila de avisos tem lembretes pendentes só para agendamentos futuros; `getAgenda` de hoje para cada conta devolve os agendamentos do dia nas colunas certas.
- [ ] **Step 2:** Rodar → FALHA. Implementar (a função `seed` recebe o relógio). Rodar → PASSA.
- [ ] **Step 3: Verificação final da fase, do zero:** `rm -rf .local .next && npm run typecheck && npm run lint && npm test && npm run test:tz && npm run build && npm run test:e2e` → tudo verde (os e2e existentes continuam passando com o seed novo). `grep -rniE "sejasans|sans (company|club|coins)|clube_sans|barber" src prisma scripts tests` → vazio. Confira com `grep -rn "from '@/server/db/client'" src/server/domain` que só `domain/platform/` aparece.
- [ ] **Step 4:** Commit: `feat: dados de demonstração da agenda`.
