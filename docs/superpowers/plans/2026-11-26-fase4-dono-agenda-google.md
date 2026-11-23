# Fase 4 — Google Agenda, começo do dono, demonstração e acabamento — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Os agendamentos de cada profissional vão para a agenda principal do Google dele (só enviar), o dono novo é guiado por `/painel/comecar` até a loja estar pronta, a demonstração "Focinho Feliz Pet Shop" é recriada no modelo novo, o painel recebe o acabamento que faltava e a publicação fica documentada.

**Architecture:** O Google Agenda é uma fila de **reconciliação**: cada agendamento tem uma linha em `calendar_syncs` com `generation` (sobe a cada mudança, dentro da transação do agendamento, sem chamar o Google) e `synced_generation`; o agendador reserva as linhas atrasadas, lê o estado atual e deixa o Google igual a ele (evento com id determinístico `af<uuid sem hífens>`, PUT e, se não existe, POST; cancelado/faltou apaga). Repetir é inofensivo; mudança durante o envio só sobe a geração e a linha volta na rodada seguinte. O token de renovação fica selado por pessoa em `calendar_connections`, com leitor restrito. O começo do dono é um passo a passo sobre as funções de domínio que já existem, com progresso em `onboarding_progress` (marcas que se juntam, nunca se sobrescrevem).

**Tech Stack:** Next.js 16 (App Router, server actions, `next/form`), React 19, TypeScript estrito, Prisma 7 + PostgreSQL (SQL à mão), `jose` 6, Vitest com Postgres embutido, lucide-react. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-23-app-unico-pet-design.md` (seções "Google Agenda (só enviar)", "Onboarding do dono", "Dados de demonstração", "Qualidade, visual e movimento", "Restrições"). Regras: `AGENTS.md`. Travas: `docs/ARQUITETURA.md` ("Travas"). Mapa do código (só fatos, pode estar velho): `.superpowers/codemap-2026-11-23.md`.

**Pré-requisito — fases 1, 2 e 3 mescladas.** Este plano usa, com os nomes exatos dos planos `2026-11-23-fase1-base-app-unico.md` e `2026-11-24-fase2-pet-agenda.md`: painel em `src/app/app/painel/**` (URL `/painel/**`), `areaLink('app', …)`, `GoogleIntent`/`startGoogleFlow`/`readGoogleFlow`/`beginGoogle`/`handleGoogleCallback`/`decideGoogle`/`GoogleFacts`/`GoogleRefusal`/`GoogleFailure`/`failureTarget` (`src/server/auth/google/**`), `googleClient()` (`auth/google/config.ts`), `GoogleGateway`/`fakeGoogleAuthority()`/`FakeGoogle` (`src/server/integrations/`), `GoogleButton`, `GOOGLE_MESSAGES` (`src/app/app/google/mensagens.ts`), rota `POST /google/entrar` (campo `fluxo`), `/google/falso`, `PersonAccountView`/`getPersonAccount`/`unlinkGoogle`/`confirmEmailChange` (`auth/person-account.ts`), `lockUserAccess` (`auth/password-reset.ts`), `requirePerson`, `requireTenant`, `src/app/app/conta/{page,actions}.tsx` e `_partes/GoogleSecao.tsx`, `runAfterResponse` (`@/server/after`), `SCHEDULER_KINDS` sem `usage_flush`; `NICHES.PET.serviceSuggestions`, `visibleVariants`, `variantDef`, `getNicheSettings`, `updateNicheOptions`, `createService` com `pricingMode`/`variantPrices` (`VariantPriceRow`), `AppointmentView.pet`, `items[].variant`, `isSqueezeIn`, `PetIllustration`, `makePet`, `makeServicePrice`, `confirmando`. Da fase 3 (área do cliente) nada é exigido além de: a exclusão de conta de cliente pode apagar `users` (as FKs abaixo cobrem). Se um nome divergir no código mesclado, o executor segue o código e registra no relatório.

## Global Constraints

Copiado da spec (literal):
- "Regras do projeto (`AGENTS.md`): domínio só em `src/server/`, `tenantDb`, `ctx.clock()`, `z` de `@/server/domain/errors`, tempo por `src/server/time/`, travas por `$lockKey` na ordem de `docs/ARQUITETURA.md`, segredos só por leitor restrito, `requireModule`, tabela nova classificada em `models.ts`, sem `any`."
- "Verificação: `npm run typecheck && npm run lint && npm test && npm run build`. Sem testes de navegador (o dono confere)."
- "Migrações em SQL com transação; produção tem só a conta `demo`."
- "Documentação enxuta: atualizar `ARQUITETURA.md`, `PUBLICACAO.md`, `.env.example`, `README.md` e `AGENTS.md` (hosts), sem histórico."
- "Publicar no Coolify (autorizado pelo dono nesta leva): domínio `app.agendaflui.com.br` (DNS já aponta para o servidor), `painel.` mantido só para redirecionar, `api.` removido."
- Google Agenda: "Ligar pede a permissão `calendar.events` (autorização incremental, acesso offline). O token de renovação fica selado por pessoa." / "título "Banho · Rex (Cão médio)", horário, observação do cliente e link para o agendamento no painel; marcados com o id do agendamento para atualizar e apagar." / "a gravação do agendamento nunca espera o Google. Ao ligar, os agendamentos futuros já existentes entram na fila." / "Se o Google recusar o token (revogado), a ligação vira "Desligada — ligue de novo" em Minha conta, sem quebrar nada." / "Desvincular também desliga o Google Agenda."
- Onboarding: "dados da loja → marca (logo e cores, com prévia ao vivo) → animais atendidos (gatos sim/não) → serviços sugeridos para pet shop (Banho, Banho e tosa, Tosa higiênica, Hidratação, Corte de unha) com a tabela por porte já preenchida com valores de exemplo para ajustar, desmarcar ou adicionar → expediente (o dono também é profissional? horários da semana) → equipe (convidar por e-mail, opcional) → link e QR para os clientes, com "Copiar" e "Compartilhar". O Início do painel mostra a lista do que falta até concluir."
- Demo: "`npm run demo:create` recria "Focinho Feliz Pet Shop" no modelo novo: serviços por porte, gatos ligados, clientes com pets de portes variados, agendamentos (inclusive um encaixe), fidelidade, banners e loja."
- "Movimento com propósito ... esqueletos em todo carregamento. Só `transform`/`opacity`; tudo desligado com `prefers-reduced-motion`." / "Toda tela com estado vazio que convida à ação, erro que diz o que fazer, carregamento, foco visível e funcionamento a partir de 360 px de largura."
- Anti-metas: "Tela crua, sem estado vazio, sem carregamento, sem resposta ao toque; animação que atrapalha ou ignora `prefers-reduced-motion`." / "Texto com "Tutor", "Tosador", "Patinhas" ou termo de outro ramo; rastro de "API do app" nas telas."
- Voz: "voz da marca: curta, verbo na frente, "você"". Termos fixos "Profissional/Profissionais", "Cliente/Clientes", "Pontos", "Clube".

Do pedido desta fase:
- Migrações novas em pastas a partir de `20261126000000`, SQL à mão com `BEGIN;`/`COMMIT;`, comentários em português; nunca editar migração antiga; índice parcial e CHECK só no SQL (comentário `///` no `schema.prisma`).
- Sem Playwright/e2e: não rode nem escreva.
- Commits locais por tarefa, em português (`tipo: descrição`), terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push. Não commitar o bloco gerado pelo `next dev` no `AGENTS.md`.
- Grupos G1–G4 fecham com `npm run typecheck` + `npx vitest run <arquivos tocados>`; G5 roda a verificação completa.

## Review Focus

1. **Mudança durante o envio** (agendamento remarcado enquanto a rodada envia a versão anterior): a rodada termina gravando `synced_generation` com a geração que leu, a linha continua atrasada e a rodada seguinte manda o horário novo; enviar duas vezes não duplica evento (id determinístico + PUT). Teste na Tarefa 3 (`mudança durante o envio volta na rodada seguinte`).
2. **Google fora do ar ou limitando** (5xx, tempo esgotado, 429): espera 1, 5, 15, 60, 240 min; na 6ª falha a linha para (`failed_at`) e uma mudança nova a revive; 429 para o resto da pessoa na rodada. Teste na Tarefa 3.
3. **Token revogado** (`invalid_grant`, 401, permissão retirada): a ligação vira `REVOKED` só se o token usado ainda é o guardado (uma religação no meio não é desfeita), as linhas não ficam tentando, Minha conta mostra "Desligada — ligue de novo" e nenhuma gravação de agendamento falha. Testes nas Tarefas 3 e 4.
4. **Voltar ao começo** (dois envios do mesmo passo, duas abas, rever "Serviços" depois de pronto, voltar ao passo depois de dispensar): nada duplica (serviço com o mesmo nome é pulado, marcas se juntam), o redirecionamento para depois de terminar ou dispensar, e o suporte nunca é redirecionado. Testes nas Tarefas 5 e 6.
5. **O evento muda de dono** (profissional religado a outra pessoa, vínculo desativado, Google desvinculado ou e-mail trocado): sai da agenda de quem tinha e entra na de quem tem agora; desvincular desliga a agenda na mesma transação. Testes nas Tarefas 2, 3 e 4.

## Decisões desta fase (onde a spec cala)

- Situações que viram evento: `PENDING`, `CONFIRMED`, `COMPLETED` (o pendente traz "Aguardando confirmação." na descrição); `CANCELED` e `NO_SHOW` apagam. Encaixe é evento normal.
- O evento usa o pet e a variante do item gravado (foto do momento); sem pet, o título é `<serviços> · <cliente>`. Serviços unidos por " + ".
- Descrição: "Cliente: <nome>", "Observação do cliente: <texto>" (se houver), estado, e "Abrir no painel: <APP_HOST>/painel/agenda?data=<AAAA-MM-DD>&ag=<id>". A agenda do painel passa a abrir o agendamento pelo `ag`.
- Quem recebe: a pessoa do vínculo **ativo** ligado ao profissional, com agenda `CONNECTED`. Mudou a pessoa (ou ninguém mais) → apaga da antiga se ela ainda está ligada.
- Desligar (ação da pessoa) apaga a ligação e revoga o token no Google depois do commit; os eventos já enviados ficam na agenda dela (a tela diz). Religar recria/atualiza pelos ids determinísticos.
- Para ligar, o Google do retorno tem de ser o Google vinculado (`sub` igual) e a pessoa tem de ser da equipe de alguma loja; pede `prompt=consent` para sempre vir o token de renovação.
- Anonimizar cliente e editar pet reenfileiram os agendamentos dele que já estão numa agenda (o nome some do Google).
- Começo: só o dono (`member` com papel `OWNER`) é redirecionado, e só a partir do Início (`/painel`). Conta sem linha em `onboarding_progress` (todas as de hoje) não tem começo; `createBusiness` cria a linha. "Terminar" (último passo) e "Dispensar" param o redirecionamento; a lista do Início some quando tudo está feito ou quando dispensado.
- "Serviços" e "Expediente" contam como feitos também quando a loja já tem serviço ativo / expediente de algum profissional (feito por outras telas).
- O dono muda as cores da marca (nova `updateBrandColors`); material e barra lateral continuam do painel dev.
- Demonstração já existente: sem `--recriar` o script só completa o que falta; com `--recriar` a demo antiga é **desligada** (slug `demo-antiga-<AAAAMMDD>`, status `SUSPENDED`, vínculos inativos), nunca apagada, e a nova nasce com o slug `demo`. A senha do dono e a do cliente de teste são geradas e impressas uma vez, só no terminal; pessoa que já existia mantém a senha.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `prisma/migrations/20261126000000_agenda_google/migration.sql` | `calendar_connections`, `calendar_syncs`, tipo de execução `calendar` |
| `prisma/migrations/20261126010000_comecar/migration.sql` | `onboarding_progress` |
| `src/server/integrations/{google,index,fakes,errors}.ts` | Token, eventos e revogação do Google atrás da interface; falso |
| `src/server/calendar/{event,token,connection,backfill,claim,worker}.ts` | Evento puro, leitor restrito do token, ligar/desligar, fila e envio |
| `src/server/domain/calendar/queue.ts` | Enfileirar dentro das transações do domínio |
| `src/server/domain/onboarding/{progress,steps}.ts` | Progresso do começo e ações compostas dos passos |
| `src/app/app/painel/comecar/**` | Telas do começo |
| `src/app/app/painel/_lib/ChecklistComeco.tsx` | "O que falta" no Início |
| `src/app/app/conta/_partes/AgendaGoogleSecao.tsx` | Google Agenda em Minha conta |
| `scripts/{demo-create,demo-data}.ts` | Demonstração no modelo novo |
| `src/ui/components/SubmitButton.tsx`, `src/app/app/painel/{error,not-found}.tsx`, `src/app/global-error.tsx` | Acabamento |
| `tests/setup/css-scan.ts` | Varredura de CSS para os testes de movimento |

## Grupos de execução

| Grupo | Tarefas | Fecha com |
|---|---|---|
| G1 — Google Agenda | 1, 2, 3, 4 | `npm run typecheck` + testes tocados |
| G2 — Começo do dono | 5, 6, 7 | idem |
| G3 — Demonstração | 8 | idem + `npm run demo:create` num banco limpo |
| G4 — Acabamento do painel | 9, 10, 11, 12 | idem |
| G5 — Publicação e verificação | 13 | `npm run typecheck && npm run lint && npm test && npm run build` |

Cada grupo começa com o anterior commitado; dentro do grupo, em ordem. G2, G3 e G4 não dependem de G1 e podem ir em paralelo em árvores separadas, mas G3 lê `onboarding_progress` (G2) — rode G3 depois de G2.

---

## G1 — Google Agenda

### Tarefa 1: Banco da agenda e o Google atrás da interface

**Files:**
- Create: `prisma/migrations/20261126000000_agenda_google/migration.sql`, `src/server/calendar/event.ts`, `tests/unit/calendar-event.test.ts`, `tests/integration/calendar-schema.test.ts`, `tests/unit/google-calendar-gateway.test.ts`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `src/server/integrations/{errors,index,google,fakes}.ts`, `src/server/notifications/scheduler-runs.ts` (`SCHEDULER_KINDS` += `'calendar'`; `LABELS` += `upserted: 'eventos gravados'`, `deleted: 'eventos apagados'`, `revoked: 'agendas desligadas'`), `tests/setup/factories.ts`

**Interfaces:**
- Produces (Prisma):
  - `enum CalendarConnectionStatus { CONNECTED REVOKED }` (`@@map("calendar_connection_status")`).
  - `model CalendarConnection` (`@@map("calendar_connections")`, PLATFORM): `userId String @id @db.Uuid @map("user_id")`, `googleSub String @map("google_sub")`, `status CalendarConnectionStatus`, `refreshTokenEnc String? @map("refresh_token_enc")`, `connectedAt DateTime @map("connected_at") @db.Timestamptz(3)`, `revokedAt DateTime? @map("revoked_at") @db.Timestamptz(3)`, `lastSyncedAt DateTime? @map("last_synced_at") @db.Timestamptz(3)`, `createdAt`, `updatedAt`; `user User @relation(onDelete: Cascade)`; `User.calendarConnection CalendarConnection?`.
  - `model CalendarSync` (`@@map("calendar_syncs")`, TENANT): `id`, `businessId`, `appointmentId String @map("appointment_id") @db.Uuid`, `generation Int @default(1)`, `syncedGeneration Int @default(0) @map("synced_generation")`, `placedUserId String? @map("placed_user_id") @db.Uuid`, `attempts Int @default(0)`, `nextAttemptAt DateTime? @map("next_attempt_at")`, `lockedUntil DateTime? @map("locked_until")`, `lockedBy String? @map("locked_by")`, `lastError String? @map("last_error") @db.VarChar(40)`, `failedAt DateTime? @map("failed_at")` (todas `Timestamptz(3)`), `createdAt`, `updatedAt`; `@@unique([businessId, id])`, `@@unique([businessId, appointmentId])`, `@@index([placedUserId])`; relações `appointment Appointment @relation(onDelete: Cascade)` (`Appointment.calendarSync CalendarSync?`) e `placedUser User? @relation("CalendarSyncPlacedUser", onDelete: SetNull)`.
  - `models.ts`: `CalendarConnection` em `PLATFORM_MODELS`, `CalendarSync` em `TENANT_MODELS`.
- Produces (integrações):
  - `IntegrationErrorCode` += `'revoked' | 'rate_limited'`.
  - `GoogleGateway` ganha: `exchangeCode(...)` devolve `{ idToken: string; refreshToken: string | null; scope: string | null }` (quem só lê `idToken` não muda); `refreshAccessToken(i: { clientId: string; clientSecret: string; refreshToken: string }): Promise<{ accessToken: string }>` (400 `invalid_grant` → `IntegrationError('revoked')`); `upsertEvent(i: { accessToken: string; event: CalendarEventBody }): Promise<void>` (PUT `https://www.googleapis.com/calendar/v3/calendars/primary/events/{id}`; 404 → POST `.../events` com o `id`; 409 no POST → PUT de novo uma vez); `deleteEvent(i: { accessToken: string; eventId: string }): Promise<void>` (404 e 410 = feito); `revokeToken(token: string): Promise<void>` (POST `https://oauth2.googleapis.com/revoke`, falha engolida). Mapa de erro: 401 e 403 `insufficientPermissions`/`forbidden` → `revoked`; 429 e 403 `rateLimitExceeded`/`userRateLimitExceeded` → `rate_limited`; 5xx → `unavailable`; tempo → `timeout`; outro 4xx → `rejected`.
  - `FakeGoogle` ganha: `issueCode(claims, o?: { scope?: string; refreshToken?: string | null })` (padrão `scope 'openid email profile'`, sem token de renovação); `calendarOf(sub: string): ReadonlyMap<string, CalendarEventBody>` (eventos vivos); `revokeAll(sub: string): void`; `failNext(op: 'refresh' | 'upsert' | 'delete', code: IntegrationErrorCode, times?: number): void`; `calls: { op: 'refresh' | 'upsert' | 'delete' | 'revoke'; sub: string; eventId?: string }[]`; `reset()` limpa tudo. Token de renovação falso `rt-<sub>-<n>`, de acesso `at-<sub>`.
- Produces (`event.ts`, puro):
  - `CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'`.
  - `calendarEventId(appointmentId: string): string` = `'af' + uuid sem hífens, minúsculo`.
  - `type CalendarAppointment = { id: string; status: AppointmentStatus; startsAt: Date; endsAt: Date; customerName: string; customerNote: string | null; petName: string | null; variant: PriceVariant | null; serviceNames: string[] }`.
  - `type CalendarEventBody = { id: string; status: 'confirmed'; summary: string; description: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string }; extendedProperties: { private: { agendafluiAppointmentId: string } }; reminders: { useDefault: true } }`.
  - `isCalendarVisible(status: AppointmentStatus): boolean` (`PENDING|CONFIRMED|COMPLETED`).
  - `buildCalendarEvent(a: CalendarAppointment, o: { timeZone: string; painelUrl: string }): CalendarEventBody` — título `${serviços.join(' + ')} · ${petName} (${variantDef(variant).label})`, sem variante `… · ${petName}`, sem pet `… · ${customerName}`, cortado em 200 caracteres com "…"; `dateTime` pelo `src/server/time` no fuso da conta (com deslocamento, ex. `2026-11-26T14:00:00-03:00`).

- [ ] **Step 1: Testes que falham.** `tests/unit/calendar-event.test.ts`:
  - `test('título "Banho · Rex (Cão médio)" e "Banho + Hidratação · Mia (Gato)"')`
  - `test('sem pet: "Banho · Marina Souza"; título longo termina em "…" com 200 caracteres')`
  - `test('descrição: cliente, observação, "Aguardando confirmação." para PENDING e "Abrir no painel: <url>"')`
  - `test('horário no fuso da conta com deslocamento e timeZone America/Sao_Paulo')`
  - `test('id determinístico: af + 32 hex, só caracteres base32hex, igual para o mesmo agendamento')`
  - `test('extendedProperties.private.agendafluiAppointmentId é o id')`
  `tests/integration/calendar-schema.test.ts`: `calendar_connections_token_by_status` recusa `CONNECTED` sem token e `REVOKED` com token; `calendar_connections_revoked_at` recusa `REVOKED` sem `revoked_at`; `calendar_syncs_generation_check` recusa `synced_generation > generation`; agendamento de outra conta → `calendar_syncs_appointment_same_business_fkey`; apagar a pessoa apaga a ligação e anula `placed_user_id`; `scheduler_runs_kind_check` aceita `calendar`. `tests/unit/google-calendar-gateway.test.ts` (real, com `fetch` falso injetado pelo `http.ts`): PUT 404 → POST com o mesmo `id`; DELETE 410 → resolve; token 400 `invalid_grant` → `revoked`; 403 `userRateLimitExceeded` → `rate_limited`; 503 → `unavailable`; nenhuma mensagem de erro traz o corpo da resposta.
- [ ] **Step 2:** `npx vitest run tests/unit/calendar-event.test.ts tests/integration/calendar-schema.test.ts tests/unit/google-calendar-gateway.test.ts` → FAIL.
- [ ] **Step 3: Migração** (`20261126000000_agenda_google`), entre `BEGIN;` e `COMMIT;`, com comentários em português: tipo `calendar_connection_status`; `calendar_connections` (PK `user_id`, FK `users ON DELETE CASCADE`, CHECKs `calendar_connections_token_by_status` = `("status" = 'CONNECTED') = ("refresh_token_enc" IS NOT NULL)` e `calendar_connections_revoked_at` = `("status" = 'REVOKED') = ("revoked_at" IS NOT NULL)`); `calendar_syncs` (FK simples `appointment_id → appointments ON DELETE CASCADE`, composta `calendar_syncs_appointment_same_business_fkey (business_id, appointment_id) → appointments(business_id, id) ON DELETE CASCADE ON UPDATE NO ACTION`, `placed_user_id → users ON DELETE SET NULL`, únicos, CHECKs `calendar_syncs_generation_check` (`synced_generation >= 0 AND synced_generation <= generation`) e `calendar_syncs_attempts_check` (`attempts BETWEEN 0 AND 6`), índice parcial `calendar_syncs_due_idx ON (next_attempt_at) WHERE generation > synced_generation AND failed_at IS NULL`); troca de `scheduler_runs_kind_check` para `('notifications', 'cleanup', 'store', 'retention', 'calendar')`. Schema, `models.ts`, integrações e `event.ts` conforme Interfaces. Fábricas: `makeCalendarConnection(userId: string, o?: { status?: CalendarConnectionStatus; googleSub?: string; refreshToken?: string }): Promise<CalendarConnection>` (sela com `calendarTokenAad`, ver Tarefa 3).
- [ ] **Step 4:** `npx prisma generate && npm run typecheck` + os testes do Step 1 + `tests/integration/schema.test.ts tests/unit/google-id-token.test.ts tests/integration/google-callback.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: banco e gateway do Google Agenda`.

### Tarefa 2: Enfileirar sem esperar o Google

**Files:**
- Create: `src/server/domain/calendar/queue.ts`, `tests/integration/calendar-queue.test.ts`
- Modify: `src/server/domain/scheduling/appointment-view.ts` (`afterChange`), `src/server/domain/customers/customers.ts` (`anonymizeCustomer`), `src/server/domain/pets/pets.ts` (`updatePet`), `src/server/domain/team/professionals.ts` (`updateProfessional` quando `membershipId` muda), `src/server/domain/platform/access-core.ts` (desativar/reativar vínculo, remover profissional), `docs/ARQUITETURA.md` (seção da fila)

**Interfaces:**
- Produces:
  - `enqueueCalendarSync(tx: TenantTx, ctx: TenantContext, appointmentId: string): Promise<void>` — `tx.calendarSync.upsert({ where: { businessId_appointmentId }, create: { appointmentId }, update: { generation: { increment: 1 }, attempts: 0, nextAttemptAt: null, failedAt: null, lastError: null } })`. Não chama o Google, não lê ligação.
  - `enqueueCalendarFor(tx: TenantTx, ctx: TenantContext, scope: { professionalId: string } | { petId: string } | { customerId: string }, o: { futureOnly: boolean }): Promise<number>` — agendamentos do escopo (futuro = `endsAt >= ctx.clock()`), em ordem de id, um `enqueueCalendarSync` cada.
  - `enqueueCalendarForProfessionalsRaw(tx: Prisma.TransactionClient, i: { businessId: string; professionalIds: string[]; now: Date }): Promise<number>` em `src/server/calendar/backfill.ts` (para o domínio de plataforma, que usa o cliente cru): `INSERT … SELECT … ON CONFLICT (business_id, appointment_id) DO UPDATE SET generation = calendar_syncs.generation + 1, attempts = 0, next_attempt_at = NULL, failed_at = NULL, last_error = NULL` só de agendamentos futuros.
- Pontos de chamada (todos na transação que já existe; nenhuma trava nova):
  - `afterChange`: **antes** do `return` de `'adjusted'`, para todo evento (`booked`, `rescheduled`, `canceled`, `confirmed`, `completed`, `no_show`, `outcome_undone`, `adjusted`) → `enqueueCalendarSync(tx, ctx, appointment.id)`.
  - `anonymizeCustomer`: depois de cancelar os abertos → `enqueueCalendarFor(tx, ctx, { customerId }, { futureOnly: false })` limitado aos que já têm `calendar_syncs.placed_user_id` não nulo.
  - `updatePet` com nome mudado → `enqueueCalendarFor({ petId }, { futureOnly: true })`.
  - `updateProfessional` com `membershipId` diferente → `enqueueCalendarFor({ professionalId }, { futureOnly: true })`.
  - `access-core.ts`: ao desativar ou reativar um vínculo e ao remover profissional → `enqueueCalendarForProfessionalsRaw` com os profissionais ligados ao vínculo.

- [ ] **Step 1: Testes que falham** (`tests/integration/calendar-queue.test.ts`, conta pet, relógio fixo):
  - `test('marcar cria a linha com generation 1 e synced 0; remarcar, ajustar, cancelar, faltar, concluir e desfazer sobem a geração')`
  - `test('enfileirar zera tentativas, falha e espera de uma linha que tinha desistido')`
  - `test('a marcação grava mesmo sem nenhuma ligação e sem chamar o Google')` (`fakeGoogleAuthority().calls` vazio)
  - `test('falha da marcação (needs_confirmation) não deixa linha na fila')`
  - `test('anonimizar reenfileira só os agendamentos que já estão numa agenda')`
  - `test('renomear o pet reenfileira os agendamentos futuros dele')`
  - `test('religar o profissional a outro vínculo reenfileira os futuros')` (Review Focus 5)
  - `test('desativar o vínculo reenfileira os futuros do profissional ligado')` (Review Focus 5)
  - `test('enqueueCalendarForProfessionalsRaw em paralelo com uma remarcação: as duas subidas valem (generation 3)')`
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar.** `docs/ARQUITETURA.md`: na seção da fila, um parágrafo "Google Agenda": linha por agendamento, geração e reconciliação, nenhuma trava nova (o enfileiramento roda sob as travas da operação).
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/calendar-queue.test.ts tests/integration/appointments.test.ts tests/integration/squeeze-in.test.ts tests/integration/customers.test.ts tests/integration/pets.test.ts tests/integration/team-access.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: fila do Google Agenda nas transações do agendamento`.

### Tarefa 3: Envio pelo agendador (reconciliação, espera crescente, revogação)

**Files:**
- Create: `src/server/calendar/{token,claim,worker}.ts`, `tests/integration/calendar-worker.test.ts`, `tests/unit/calendar-token-imports.test.ts`
- Modify: `src/server/notifications/scheduler.ts`, `tests/unit/notification-scheduler.test.ts`, `eslint.config.mjs` (`src/server/calendar/**` liberado para o cliente cru como `src/server/notifications/**`; padrão restrito `['**/calendar/token', '**/calendar/token.*']` em todos os blocos, liberado só em `src/server/calendar/**`), `AGENTS.md` (regra de segredos: "e o token da agenda só por `calendar/token.ts` (só `src/server/calendar/**` importa; `tests/unit/calendar-token-imports.test.ts` confere)")

**Interfaces:**
- Produces (`token.ts`, leitor restrito):
  - `calendarTokenAad(userId: string): string` = `` `user:${userId}:google:calendar_refresh_token` ``.
  - `sealCalendarToken(userId: string, plain: string): string`.
  - `openCalendarToken(userId: string): Promise<{ refreshToken: string; sealed: string } | null>` — só ligação `CONNECTED`; selo que não abre → `null` e log só com o nome do erro.
- Produces (`claim.ts`): `claimCalendarSyncs(now: Date, limit: number): Promise<{ id: string; businessId: string; appointmentId: string; generation: number; placedUserId: string | null; attempts: number; lockedBy: string }[]>` — mesma forma de `notifications/claim.ts`: linhas com `generation > synced_generation`, `failed_at IS NULL`, espera vencida e reserva vencida, `FOR UPDATE SKIP LOCKED`, reserva de 2 minutos, ordem `COALESCE(next_attempt_at, updated_at), id`.
- Produces (`worker.ts`):
  - `CALENDAR_RETRY_MINUTES = [1, 5, 15, 60, 240]`; `CALENDAR_MAX_ATTEMPTS = 6`.
  - `type CalendarRoundResult = { upserted: number; deleted: number; revoked: number; retried: number; failed: number; skipped: number }`.
  - `processCalendarSyncs(o?: { now?: Date; limit?: number }): Promise<CalendarRoundResult>` — nunca lança por causa de uma linha.
  - Por linha: lê o agendamento (itens, pet, cliente, profissional → vínculo **ativo** → pessoa → ligação) e o fuso da conta; `alvo` = pessoa com ligação `CONNECTED` ou `null`; `quer` = `isCalendarVisible(status)`. Se `placedUserId` existe e (`placedUserId !== alvo` ou `!quer`) → apaga na agenda de `placedUserId` se ela ainda está `CONNECTED` (senão só esquece). Se `quer` e `alvo` → `upsertEvent` com `buildCalendarEvent` (`painelUrl = areaLink('app', '/painel/agenda?data=<data local>&ag=<id>')`) e `placedUserId = alvo`. Fim: `UPDATE … SET synced_generation = <geração lida>, placed_user_id = …, attempts = 0, next_attempt_at = NULL, last_error = NULL, locked_until = NULL, locked_by = NULL WHERE id = … AND locked_by = <meu>` e `calendar_connections.last_synced_at = now`.
  - Token de acesso: um `refreshAccessToken` por pessoa por rodada (mapa em memória da rodada, nunca gravado). `revoked` (no token ou no evento) → `markCalendarRevoked(userId, sealedUsado, now)` (UPDATE condicional `WHERE status = 'CONNECTED' AND refresh_token_enc = <selo usado>` para `REVOKED`, `revoked_at`, token nulo), a linha termina como sincronizada sem agir (mantém `placedUserId`), e as outras linhas dessa pessoa na rodada também. `rate_limited` → esta linha ganha `next_attempt_at = now + 1 min` sem contar tentativa, e as outras linhas da pessoa nesta rodada são soltas (reserva limpa) sem tocar no Google. `timeout`/`unavailable` → `attempts + 1`, `next_attempt_at = now + CALENDAR_RETRY_MINUTES[attempts-1]`; chegou a 6 → `failed_at = now`. `rejected`/erro inesperado → `failed_at` direto, `last_error` só com o código.
  - `markCalendarRevoked(userId: string, usedSealed: string, now: Date): Promise<boolean>` (também usado pela Tarefa 4).
- Agendador: `Deps.calendar?: () => Promise<unknown>` (padrão `processCalendarSyncs` quando `deps.run` não foi trocado, como `sweep`); na rodada, depois dos avisos, `timed('calendar', 'agenda do Google', calendar, worth)` com `worth` = alguma contagem > 0.

- [ ] **Step 1: Testes que falham** (`tests/integration/calendar-worker.test.ts`, `setIntegrationsForTests({ google: fake })`, chaves do Google salvas, profissional ligado à pessoa com `makeCalendarConnection`):
  - `test('marcado → um evento na agenda da pessoa com o título e o id determinísticos; rodar de novo não chama o Google')`
  - `test('cancelado e faltou apagam; concluído fica; desfazer falta recria com o mesmo id')`
  - `test('mudança durante o envio volta na rodada seguinte')` — falso que, no `upsertEvent`, remarca o agendamento pelo domínio; depois da rodada `synced_generation = 1 < generation = 2`; rodada seguinte manda o horário novo (Review Focus 1)
  - `test('duas rodadas em paralelo nunca mandam a mesma linha')`
  - `test('503 três vezes: esperas de 1, 5 e 15 min; na 6ª falha para com failed_at; remarcar revive')` (Review Focus 2)
  - `test('429 numa linha deixa as outras da mesma pessoa para depois sem contar tentativa')` (Review Focus 2)
  - `test('invalid_grant: ligação REVOKED, sem token, linha sincronizada sem agir, as outras da pessoa nem tentam')` (Review Focus 3)
  - `test('revogação não desfaz uma religação feita no meio da rodada')` — troca o selo antes de `markCalendarRevoked`; ligação continua `CONNECTED` (Review Focus 3)
  - `test('profissional religado a outra pessoa: apaga da agenda antiga e cria na nova')` (Review Focus 5)
  - `test('vínculo desativado: apaga da agenda e não recria')` (Review Focus 5)
  - `test('pessoa sem ligação: nada no Google e a linha fica sincronizada')`
  - `test('anonimizado: o evento é reescrito com "Cliente removido" e sem observação')`
  `tests/unit/calendar-token-imports.test.ts`: o desenho de `google-secrets-imports.test.ts` com `ARQUIVO = 'src/server/calendar/token.ts'` e `PASTAS_LIBERADAS = ['src/server/calendar/']`. `tests/unit/notification-scheduler.test.ts`: `test('a rodada chama a agenda depois dos avisos e só grava execução quando fez algo')`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar** conforme Interfaces.
- [ ] **Step 4:** `npm run typecheck && npx eslint src/server && npx vitest run tests/integration/calendar-worker.test.ts tests/unit/calendar-token-imports.test.ts tests/unit/notification-scheduler.test.ts tests/integration/notifications` → PASS.
- [ ] **Step 5: Commit** `feat: envio da agenda do Google pelo agendador com espera e revogação`.

### Tarefa 4: Ligar, desligar e Minha conta

**Files:**
- Create: `src/server/calendar/connection.ts`, `src/app/app/conta/_partes/AgendaGoogleSecao.tsx`, `tests/integration/calendar-connection.test.ts`, `tests/unit/conta-agenda-secao.test.tsx`
- Modify: `src/server/auth/google/{flow,decide,callback}.ts`, `src/app/app/google/entrar/route.ts`, `src/app/app/google/falso/{page,actions}.tsx`, `src/app/app/google/mensagens.ts`, `src/ui/components/GoogleButton.tsx`, `src/server/auth/person-account.ts` (`getPersonAccount`, `unlinkGoogle`, `confirmEmailChange`), `src/app/app/conta/{page,actions}.tsx`, `src/app/app/painel/agenda/{page,AgendaPainel}.tsx` (`?ag=`), `tests/unit/google-decide.test.ts`, `tests/integration/google-callback.test.ts`, `tests/integration/person-account.test.ts`, `tests/integration/conta-actions.test.ts`

**Interfaces:**
- Consumes: `CALENDAR_SCOPE`, `sealCalendarToken`, `openCalendarToken`, `markCalendarRevoked`, `enqueueCalendarForProfessionalsRaw` (Tarefas 1–3).
- Produces (Google):
  - `GoogleIntent` += `{ kind: 'calendar' }`; `startGoogleFlow(intent, now, o?: { loginHint?: string })` — para `calendar`: `scope = 'openid email ' + CALENDAR_SCOPE`, `access_type=offline`, `include_granted_scopes=true`, `prompt=consent`, `login_hint` quando dado.
  - `GoogleFacts.currentIsStaff: boolean`; `GoogleRefusal` += `'calendar_needs_google' | 'calendar_wrong_google' | 'calendar_staff_only'`; `GoogleDecision` += `{ kind: 'calendar'; userId: string }`; `GoogleFailure` += `'calendar_scope_missing'`. `decideGoogle` para `calendar`, depois da regra 10: `current` nulo → `not_signed_in`; `current.googleSub` nulo → `calendar_needs_google`; `identity.sub !== current.googleSub` → `calendar_wrong_google`; `!currentIsStaff` → `calendar_staff_only`; senão `calendar`.
  - `handleGoogleCallback` para `calendar`: escopo devolvido sem `CALENDAR_SCOPE` → `calendar_scope_missing`; sem token de renovação → `provider_error`; senão `connectCalendar` e `redirectTo = '/conta?google=agenda_ligada#agenda'`, sem sessão nova. `failureTarget({ kind: 'calendar' }, f)` = `` `/conta?google=${f}#agenda` ``.
  - `POST /google/entrar` aceita `fluxo=agenda` (exige sessão de pessoa, `login_hint` = `googleEmail` dela). `GoogleButton.fluxo` += `'agenda'`.
  - `/google/falso` com intenção `calendar`: caixa "Permitir que o Agenda Flui crie eventos na sua agenda" (marcada); marcada → `issueCode(..., { scope: 'openid email ' + CALENDAR_SCOPE, refreshToken: <novo> })`.
  - `GOOGLE_MESSAGES` += `agenda_ligada`: "Google Agenda ligada. Seus próximos atendimentos aparecem nela em instantes."; `agenda_desligada`: "Google Agenda desligada."; `calendar_needs_google`: "Vincule o Google na sua conta antes de ligar a agenda."; `calendar_wrong_google`: "Use a mesma conta Google vinculada à sua conta."; `calendar_staff_only`: "A agenda do Google é para quem é da equipe de uma loja."; `calendar_scope_missing`: "Marque a permissão da agenda na tela do Google para ligar.".
- Produces (`connection.ts`):
  - `connectCalendar(i: { userId: string; googleSub: string; refreshToken: string; now: Date }): Promise<{ queued: number }>` — numa transação com `lockUserAccess`: confere de novo que o Google vinculado é o mesmo `sub` (senão `conflict` `calendar_wrong_google`); grava a ligação `CONNECTED` com o token selado (UPSERT: religar troca o selo e limpa `revoked_at`); enfileira os futuros dos profissionais ligados ao vínculo ativo da pessoa (`enqueueCalendarForProfessionalsRaw`). Depois do commit, o selo antigo (se havia e era diferente) é revogado no Google por `runAfterResponse`.
  - `disconnectCalendarIn(tx: Prisma.TransactionClient, userId: string): Promise<string | null>` — apaga a ligação, anula `placed_user_id` dela em `calendar_syncs`, devolve o selo para revogar depois.
  - `disconnectCalendar(userId: string, now: Date): Promise<void>` — transação com `lockUserAccess` + `disconnectCalendarIn` + revogação depois do commit.
  - `type CalendarStatusView = { state: 'off' | 'on' | 'revoked'; connectedAt: Date | null; lastSyncedAt: Date | null }`; `getCalendarStatus(userId: string): Promise<CalendarStatusView>`.
- Produces (Minha conta): `PersonAccountView.calendar: (CalendarStatusView & { available: boolean }) | null` — `null` quando a pessoa não é da equipe; `available` = Google configurado e vinculado. `unlinkGoogle` e `confirmEmailChange` (quando `googleUnlinked`) chamam `disconnectCalendarIn` na mesma transação e revogam depois. Ação `desligarAgenda` (→ `?google=agenda_desligada#agenda`).
- Tela `AgendaGoogleSecao` (`Card` `id="agenda"`, título "Google Agenda", depois de "Google"): sem Google vinculado → "Vincule o Google acima para ligar a agenda."; `off` → "Seus atendimentos aparecem na agenda principal do seu Google e acompanham remarcações e cancelamentos." + `GoogleButton fluxo="agenda" label="Ligar Google Agenda"`; `on` → `StatusDot` "Ligada", "Atualizada em <data>" (ou "Enviando seus atendimentos…" sem `lastSyncedAt`), `ConfirmForm` "Desligar" ("Desligar a agenda? Os eventos já enviados ficam na sua agenda do Google."); `revoked` → `StatusDot` de perigo "Desligada — ligue de novo", "O Google recusou o acesso. Ligue de novo para voltar a enviar.", `GoogleButton fluxo="agenda" label="Ligar de novo"`. `?google=` mostra a mensagem (`role="alert"` para erro, `role="status"` para sucesso).
- Agenda do painel: `?ag=<id>` abre `AppointmentSheet` desse agendamento (se a pessoa pode vê-lo; senão só abre o dia de `?data=`).

- [ ] **Step 1: Testes que falham.**
  - `google-decide.test.ts`: `test('agenda: Google vinculado igual e equipe → calendar')`, `test('agenda: sem Google vinculado, Google diferente, não é equipe, não entrado e e-mail não verificado são recusados')`.
  - `google-callback.test.ts`: `test('ligar agenda: ligação CONNECTED com token selado (o banco não tem o texto), futuros enfileirados, destino /conta?google=agenda_ligada#agenda')`; `test('ligar sem a permissão da agenda: calendar_scope_missing e nada gravado')`; `test('religar depois de revogada: volta a CONNECTED e revoga o selo antigo depois')`; `test('URL de autorização da agenda tem access_type=offline, include_granted_scopes=true, prompt=consent e o escopo calendar.events')`.
  - `calendar-connection.test.ts`: `test('desligar apaga a ligação, anula placed_user_id e chama revokeToken depois do commit')`; `test('desvincular o Google desliga a agenda na mesma transação')` (Review Focus 5); `test('trocar o e-mail para outro que não o do Google desliga a agenda')`; `test('getCalendarStatus: off, on e revoked')`; `test('connectCalendar com sub diferente do vinculado: conflict')`.
  - `person-account.test.ts`: `test('calendar é null para cliente e traz o estado para a equipe')`. `conta-actions.test.ts`: `test('desligarAgenda usa a pessoa da sessão e volta com agenda_desligada')`.
  - `conta-agenda-secao.test.tsx`: `test('revogada mostra "Desligada — ligue de novo" e o botão "Ligar de novo"')`, `test('ligada mostra "Desligar"; sem Google vinculado não mostra botão')`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3: Implementar** conforme Interfaces.
- [ ] **Step 4:** `npm run typecheck && npx vitest run` nos arquivos do Step 1 + `tests/unit/google-flow.test.ts tests/integration/google-routes.test.ts tests/integration/painel-agenda-page.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: ligar e desligar o Google Agenda em Minha conta`.

**G1 termina:** `npm run typecheck && npx vitest run <testes tocados em 1–4>` e `npx eslint src/server src/app`.

---

## G2 — Começo do dono

### Tarefa 5: Progresso do começo

**Files:**
- Create: `prisma/migrations/20261126010000_comecar/migration.sql`, `src/server/domain/onboarding/progress.ts`, `tests/integration/onboarding-progress.test.ts`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts` (`OnboardingProgress` em `TENANT_MODELS`), `src/server/domain/platform/businesses.ts` (`createBusiness` cria a linha), `tests/setup/factories.ts`

**Interfaces:**
- Produces (Prisma): `enum OnboardingStep { STORE BRAND ANIMALS SERVICES HOURS TEAM LINK }` (`@@map("onboarding_step")`); `model OnboardingProgress` (`@@map("onboarding_progress")`): `id`, `businessId String @unique @map("business_id") @db.Uuid`, `doneSteps OnboardingStep[] @default([]) @map("done_steps")`, `skippedSteps OnboardingStep[] @default([]) @map("skipped_steps")`, `wizardFinishedAt DateTime? @map("wizard_finished_at")`, `completedAt DateTime? @map("completed_at")`, `dismissedAt DateTime? @map("dismissed_at")` (`Timestamptz(3)`), `version Int @default(1)`, `createdAt`, `updatedAt`; `@@unique([businessId, id])`; `business Business @relation(onDelete: Cascade)`. SQL: tabela, FK `businesses ON DELETE CASCADE`, CHECK `onboarding_progress_steps_disjoint` (`NOT ("done_steps" && "skipped_steps")`). Contas existentes ficam sem linha (comentário: já estão montadas).
- Produces (`progress.ts`):
  - `type OnboardingStepKey = OnboardingStep`; `ONBOARDING_STEPS: readonly { key: OnboardingStepKey; slug: 'loja' | 'marca' | 'animais' | 'servicos' | 'expediente' | 'equipe' | 'link'; label: string; nicheOnly: boolean }[]` na ordem da spec — rótulos "Dados da loja", "Marca", "Animais atendidos" (`nicheOnly`), "Serviços", "Expediente", "Equipe", "Link para clientes".
  - `type OnboardingView = { steps: { key: OnboardingStepKey; slug: string; label: string; status: 'done' | 'skipped' | 'todo' }[]; done: number; total: number; current: OnboardingStepKey | null; wizardFinished: boolean; completed: boolean; dismissed: boolean }`.
  - `getOnboarding(ctx: TenantContext): Promise<OnboardingView | null>` — exige `manage_account` (senão `null`); sem linha → `null`; `ANIMALS` some sem nicho; `SERVICES` feito também com ≥ 1 serviço ativo; `HOURS` feito também com expediente de algum profissional ativo; `current` = primeiro não feito (pulados contam como não feitos, depois dos `todo`).
  - `markOnboardingStep(ctx: TenantContext, step: OnboardingStepKey, how: 'done' | 'skipped'): Promise<OnboardingView>` — `manage_account`; lê, junta (feito tira de pulados; pulado não rebaixa feito), grava com `version` condicional; versão mudou no meio → relê e junta de novo (até 3 vezes; depois `conflict` `stale_version`); todos feitos → `completedAt = now`. Audit `onboarding.step_marked { step, how }`.
  - `finishOnboardingWizard(ctx)`, `dismissOnboarding(ctx)` — `manage_account`, idempotentes (só gravam se nulo); audit `onboarding.finished` / `onboarding.dismissed`.
  - `shouldRedirectToOnboarding(ctx: TenantContext): Promise<boolean>` — `ctx.actor.kind === 'member' && ctx.actor.role === 'OWNER'`, linha existe e `wizardFinishedAt`, `completedAt` e `dismissedAt` nulos.
- Fábrica: `makeOnboarding(businessId: string, o?: Partial<{ doneSteps: OnboardingStep[]; skippedSteps: OnboardingStep[]; wizardFinishedAt: Date; dismissedAt: Date }>)`.

- [ ] **Step 1: Testes que falham** (`onboarding-progress.test.ts`):
  - `test('createBusiness cria o progresso vazio; conta sem linha não tem começo (getOnboarding null)')`
  - `test('ordem e rótulos; sem nicho o passo Animais some')`
  - `test('marcar feito tira de pulados; pular não rebaixa um feito')`
  - `test('dois envios do mesmo passo e duas abas marcando passos diferentes: as marcas se juntam, sem erro')` (Review Focus 4)
  - `test('Serviços e Expediente contam como feitos pelo que já existe na loja')`
  - `test('todos feitos: completedAt preenchido')`
  - `test('shouldRedirect: dono sim; gerente, profissional e suporte não; depois de terminar ou dispensar não')` (Review Focus 4)
  - `test('gerente não lê nem marca (null / forbidden)')`
  - `test('schema: done e skipped não se cruzam (onboarding_progress_steps_disjoint)')`
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Migração, schema, `models.ts`, domínio, `createBusiness` (`onboarding: { create: {} }`), fábrica.
- [ ] **Step 4:** `npx prisma generate && npm run typecheck && npx vitest run tests/integration/onboarding-progress.test.ts tests/integration/schema.test.ts tests/integration/platform-businesses.test.ts tests/integration/dev-create-account-action.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: progresso do começo do dono`.

### Tarefa 6: Ações compostas dos passos

**Files:**
- Create: `src/server/domain/onboarding/steps.ts`, `tests/integration/onboarding-steps.test.ts`
- Modify: `src/server/domain/catalog/services.ts` (extrai `createServiceIn`), `src/server/domain/settings/business-profile.ts` (`updateBrandColors`), `src/server/domain/platform/customization.ts` (exporta o esquema de cor), `src/server/domain/team/professionals.ts` (se precisar de `linkAllServicesIn`)

**Interfaces:**
- Consumes: `NICHES.PET.serviceSuggestions`, `visibleVariants`, `getNicheSettings`, `VariantPriceRow`, `createService`, `createProfessional`, `setWeekSchedule`, `WeekSchedule`, `addTeamMember`, `markOnboardingStep`.
- Produces:
  - `createServiceIn(tx: TenantTx, ctx: TenantContext, input: ServiceInput, opts?: ServiceWriteOptions): Promise<ServiceView>` — o corpo de hoje de `createService` (que passa a só abrir a transação com a trava `catalog` e chamá-la).
  - `brandColorSchema` exportado de `customization.ts` (o mesmo usado em `marcaSchema`); `updateBrandColors(ctx: TenantContext, version: number, input: { primary: string; accent: string }): Promise<BusinessAppearance & { version: number }>` — `manage_account`, UPDATE condicional na versão da marca, audit `brand.updated` com `{ changes }`; `getBusinessAppearance` passa a trazer `version`.
  - `type SuggestionRow = { name: string; icon: ServiceIconName; description: string | null; prices: VariantPriceRow[] }`.
  - `getServiceSuggestions(ctx): Promise<{ rows: (SuggestionRow & { exists: boolean })[]; variants: VariantDef[] }>` — sugestões do nicho só com as variantes visíveis; `exists` = já há serviço ativo com o mesmo nome (`searchKey`).
  - `applyServiceSuggestions(ctx: TenantContext, rows: SuggestionRow[]): Promise<{ created: number; skipped: number }>` — `manage_catalog`; 1 a 15 linhas; uma transação com `$lockKey('catalog', businessId)`; nome já existente (ativo, por `searchKey`) é pulado; cada um `BY_VARIANT` via `createServiceIn` (sem `onGrid`), ligado a todos os profissionais ativos; marca `SERVICES` feito.
  - `setupOwnerSchedule(ctx: TenantContext, i: { attends: boolean; schedule?: Partial<WeekSchedule> }): Promise<{ professionalId: string | null }>` — `manage_account`; `attends` → acha ou cria (`createProfessional`, nome da pessoa, `membershipId` do dono, todos os serviços ativos) e grava o expediente com `setWeekSchedule`; sem `attends` → nada criado; marca `HOURS` feito. Repetir não cria segunda ficha.
  - `inviteTeamFromOnboarding(ctx, rows: { name: string; email: string; role: 'PROFESSIONAL' | 'MANAGER' }[]): Promise<{ invited: number; errors: Record<number, string> }>` — até 5; cada uma por `addTeamMember`; e-mail que já está na equipe vira erro da linha ("Esta pessoa já está na equipe."), as outras seguem; marca `TEAM` feito quando ao menos uma deu certo.

- [ ] **Step 1: Testes que falham** (`onboarding-steps.test.ts`, conta pet com dono e progresso):
  - `test('sugestões: os cinco da spec, com a linha de gato só com servesCats')`
  - `test('aplicar cria BY_VARIANT com as linhas enviadas e liga aos profissionais ativos')`
  - `test('aplicar duas vezes (ou depois de criar Banho na tela de serviços): pula os que existem, nada duplica')` (Review Focus 4)
  - `test('linha sem nenhum porte: validation com o nome do serviço; nada gravado')`
  - `test('setupOwnerSchedule cria a ficha do dono com os serviços e o expediente; repetir reaproveita a ficha')` (Review Focus 4)
  - `test('setupOwnerSchedule sem atender: nenhuma ficha e passo feito')`
  - `test('updateBrandColors grava as cores com versão; versão velha: stale_version; cor inválida: validation')`
  - `test('convites: um repetido vira erro da linha e os outros são enviados')`
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/onboarding-steps.test.ts tests/integration/services.test.ts tests/integration/services-pricing.test.ts tests/integration/business-profile.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: ações dos passos do começo (serviços sugeridos, expediente do dono, cores)`.

### Tarefa 7: Telas do começo e "o que falta" no Início

**Files:**
- Create: `src/app/app/painel/comecar/{page,loading,actions}.tsx`, `src/app/app/painel/comecar/_passos/{PassoLoja,PassoMarca,PassoAnimais,PassoServicos,PassoExpediente,PassoEquipe,PassoLink,Navegacao}.tsx`, `src/app/app/painel/_lib/ChecklistComeco.tsx`, `src/ui/components/ShareButton.tsx` (+ export), `src/ui/styles/comecar.css` (+ `@import` em `src/ui/ui.css` antes de `motion.css`), `tests/integration/painel-comecar-actions.test.ts`, `tests/unit/ui/ChecklistComeco.test.tsx`, `tests/unit/ui/ShareButton.test.tsx`
- Modify: `src/app/app/painel/page.tsx` (redireciona e mostra a lista); o começo não entra no menu

**Interfaces:**
- Consumes: Tarefas 5 e 6; `updateBusinessProfile`, `setBusinessLogo`, `getBusinessProfile`, `getBusinessAppearance`, `updateNicheOptions`, `getCustomerLink`, `BrandPreview`, `ColorField`, `WeekScheduleEditor`, `StepRail`, `MoneyField`, `PetIllustration`, `CopyButton`, `Meter`.
- Produces:
  - `/painel/comecar?passo=<slug>` (`requireTenant('manage_account')`; sem progresso → `redirect('/painel')`; sem `passo` → `current` ou `link`). Moldura `PainelFrame` título "Começar", `StepRail` com os passos e o estado de cada um, barra "3 de 7" (`Meter`), passo atual num `Card`. Rodapé de todo passo (`Navegacao`): "Voltar", "Pular por agora" (marca `skipped` e avança) e o botão principal (salva, marca `done` e avança). Link discreto "Dispensar o passo a passo" (`ConfirmForm` "Dispensar? Você continua tudo pelas telas do painel.").
  - Passos: **Loja** — Nome, E-mail de contato, Telefone de contato ("Salvar e continuar"). **Marca** — Logo (upload como em Configurações), Cor principal e Cor de destaque (`ColorField`), `BrandPreview` ao vivo com as cores digitadas (cliente) e nota de contraste quando o texto sobre a cor principal não passa 4,5:1 (`deriveTheme` já calcula); salva por `updateBrandColors`. **Animais** — "Cães são sempre atendidos." + `Switch` "Atende gatos". **Serviços** — uma tabela por sugestão: caixa "Oferecer", nome editável, e por porte visível `PetIllustration` + `MoneyField` + duração (`Select` de 5 em 5 min, 5–600) já preenchidos; "Já cadastrado" desliga a linha; "Adicionar outro serviço" acrescenta linha vazia; até 560 px cada sugestão vira cartão. **Expediente** — "Você também atende?" (Sim/Não); Sim → `WeekScheduleEditor` com segunda a sexta 09:00–18:00 e sábado 09:00–13:00 pré-preenchidos. **Equipe** — até 5 linhas (Nome, E-mail, Profissional/Gerente) com "Adicionar pessoa"; erros por linha. **Link** — link grande, QR (`qrSvg`), `CopyButton` "Copiar" e `ShareButton` "Compartilhar"; botão principal "Terminar e ir para o painel" (`finishOnboardingWizard` → `/painel`).
  - `ShareButton({ url, title, text })` — `navigator.share` quando existe; senão copia e mostra "Link copiado."; erro de cancelamento do usuário não mostra nada.
  - Ações (`tenantAction('manage_account', …)`): `salvarLoja`, `salvarMarca`, `salvarAnimais`, `salvarServicos`, `salvarExpediente`, `convidarEquipe`, `pularPasso`, `terminar`, `dispensar` — cada uma chama o domínio e `redirect('/painel/comecar?passo=<próximo>')`.
  - Início: antes de tudo, `if (await shouldRedirectToOnboarding(ctx)) redirect('/painel/comecar')`; `ChecklistComeco({ view })` no topo quando `getOnboarding` não é nulo, não `completed` e não `dismissed`: título "Falta pouco para abrir sua agenda", `Meter` "4 de 7", lista dos passos `todo`/`skipped` com link para o passo, botão "Continuar" (primeiro que falta) e "Dispensar" (`ConfirmForm`). Concluído na hora → "Tudo pronto. Sua loja já pode receber clientes." uma vez (some quando `completedAt` tem mais de 1 dia).
  - Movimento: troca de passo desliza 8 px + `opacity` (só sob `prefers-reduced-motion: no-preference`, tokens de `motion.css`); barra do `Meter` anima `transform: scaleX`; marca de passo feito com leve `scale`.

- [ ] **Step 1: Testes que falham.** `painel-comecar-actions.test.ts` (guards mockados como em `painel-customers-actions.test.ts`):
  - `test('dono no Início com começo aberto é redirecionado para /painel/comecar; depois de terminar não')`
  - `test('suporte e gerente no Início não são redirecionados')` (Review Focus 4)
  - `test('salvarServicos cria os marcados com a tabela enviada e vai para expediente')`
  - `test('salvarServicos reenviado (duplo clique) não duplica')` (Review Focus 4)
  - `test('pularPasso marca skipped e avança; voltar ao passo pulado e salvar marca done')`
  - `test('dispensar para o redirecionamento e some a lista do Início')`
  - `test('gerente abrindo /painel/comecar recebe 404')`
  `ChecklistComeco.test.tsx`: `test('mostra "4 de 7", lista só o que falta e o botão Continuar aponta para o primeiro')`. `ShareButton.test.tsx`: `test('sem navigator.share copia e mostra "Link copiado."')`, `test('cancelamento do compartilhamento não mostra erro')`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar (todo passo com `loading` no botão, erro de campo, foco no título do passo ao trocar, funciona a 360 px; `loading.tsx` com `ShellSkeleton variant="detail"`).
- [ ] **Step 4:** `npm run typecheck && npx vitest run` nos arquivos do Step 1 + `tests/integration/painel-home.test.ts tests/unit/painel-links.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: começo do dono em /painel/comecar e lista do que falta no Início`.

**G2 termina:** `npm run typecheck && npx vitest run <testes tocados em 5–7>`.

---

## G3 — Demonstração

### Tarefa 8: `demo:create` no modelo novo

**Files:**
- Modify: `scripts/demo-create.ts`, `scripts/demo-data.ts`
- Create: `tests/integration/demo-create.test.ts`

**Interfaces:**
- Produces: `criarDemo(prisma: PrismaClient, opts?: { now?: Date; log?: (t: string) => void; recriar?: boolean; aoCriar?: (senhas: { dono: string; cliente: string | null }) => void }): Promise<DemoResultado>`; `DemoResultado` += `recriada: boolean`. `main()` lê `--recriar` de `process.argv`.
- Dados (`demo-data.ts`):
  - Conta "Focinho Feliz Pet Shop" (`DEMO_MARCA`), `niche: 'PET'`, `nicheOptions { servesCats: true }`, módulos fidelidade, banners e loja ligados, progresso do começo com `completedAt` (a demo não abre o passo a passo).
  - `DEMO_SERVICOS` reescrito: Banho, Banho e tosa, Tosa higiênica, Hidratação e Corte de unha `BY_VARIANT` com os valores de `NICHES.PET.serviceSuggestions` (todas as cinco variantes); "Limpeza de ouvidos" `SINGLE` R$ 30,00 / 15 min; "Spa relaxante" `BY_VARIANT` só cães, clube. Pontos = preço em reais / 5, arredondado.
  - Bio das profissionais sem "Tosadora"/termo de outro ramo ("Cuida de banho e tosa há 9 anos, com jeito para pelo longo.").
  - `DEMO_CLIENTES`: 14 clientes — 8 com conta (pessoa com e-mail `<apelido>@clientes.demo.agendaflui.com.br`, senha aleatória não impressa, `Customer.userId`, origem `APP`), 6 de balcão (sem pessoa, origem `PANEL`); um cliente de teste com conta `cliente.teste@agendaflui.com.br` cuja senha é gerada e impressa. Cada cliente com 1–2 pets: cães dos quatro portes e 3 gatos, raças das sugestões, alguns com cuidados ("Medo de secador", "Idoso").
  - Agenda: `planejarAgenda` passa a sortear o pet do cliente e só serviços oferecidos à variante do pet (`isServiceOffered` com `who: 'staff'`); todo agendamento com `petId`; exatamente um encaixe futuro (dia útil seguinte, 10:30, por cima de um normal da mesma profissional, marcado com `confirmando`).
  - Fidelidade, prêmios, resgates, banners, categorias, produtos e pedidos como hoje (pedidos de clientes com conta).
- Comportamento:
  - Conta `demo` não existe → cria tudo; `aoCriar({ dono, cliente })` uma vez.
  - Existe, é nossa (`demo.conta_criada`) e sem `recriar` → completa o que falta (como hoje) e não troca senha.
  - Existe, é nossa e `recriar` → numa transação: slug `demo-antiga-<AAAAMMDD>` (com sufixo `-2`, `-3` se já houver), `status: 'SUSPENDED'`, todos os vínculos `active: false`; audit `demo.recriada`; depois cria a nova. Não é nossa → para com a frase de hoje.
  - Pessoa que já existia (dono, equipe ou cliente de teste) mantém a senha e não é impressa; o script diz qual.
  - Nada grava senha em auditoria, log ou banco além do hash.

- [ ] **Step 1: Testes que falham** (`demo-create.test.ts`, relógio fixo, `prisma` cru):
  - `test('cria a demo pet: nicho PET, gatos ligados, 5 serviços BY_VARIANT com linha de gato, começo concluído')`
  - `test('clientes com conta ligados a pessoas e clientes de balcão sem pessoa')`
  - `test('pets de todos os portes e gatos; todo agendamento tem pet do próprio cliente')`
  - `test('exatamente um encaixe futuro e as invariantes de encaixe valem')` (`invariantesDoEncaixe` vazio)
  - `test('nenhum item usa serviço não oferecido para a variante do pet')`
  - `test('rodar de novo não duplica nada e não chama aoCriar')`
  - `test('recriar desliga a antiga (slug demo-antiga-…, SUSPENDED, vínculos inativos) e cria a nova com o slug demo')`
  - `test('as senhas só saem por aoCriar: auditoria e logs não as contêm')`
  - `test('nenhum texto da demo usa "tutor", "tosador" ou "patinhas"')`
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar; `main()` imprime, só no terminal: e-mail e senha do dono, e-mail e senha do cliente de teste, "Link de entrada" (`areaLink('app', '/entrar')`) e "Link para clientes" (`customerLinkUrl('demo')`), e a linha "Rode com --recriar para refazer a demonstração do zero." quando a demo já existia.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/demo-create.test.ts`; com o banco local (`npm run db:reset`), `npm run demo:create` e `npm run demo:create -- --recriar` terminam; se o banco não subir, registre.
- [ ] **Step 5: Commit** `feat: demonstração Focinho Feliz no modelo novo (pets, porte, encaixe, contas)`.

---

## G4 — Acabamento do painel

Achados de uma leitura das telas atuais (caminhos já no formato pós-fase 1). Cada tarefa corrige uma família e trava com teste estrutural ou de componente.

### Tarefa 9: Erro e "não encontrado" com a cara do painel

**Files:**
- Create: `src/app/app/painel/error.tsx`, `src/app/app/painel/not-found.tsx`, `src/app/app/error.tsx`, `src/app/global-error.tsx`, `tests/unit/painel-error.test.tsx`
- Modify: `src/app/not-found.tsx` (hoje só `<main><h1>`), `src/app/app/painel/_lib/modulo.ts` (módulo desligado continua `notFound()`, agora com a tela nova)

**Interfaces:**
- `painel/error.tsx` (`'use client'`, `{ error, reset }`): `Card` + `EmptyState` título "Não deu para abrir esta tela", texto "Tente de novo. Se continuar, volte ao início e abra de novo.", `Button` "Tentar de novo" (`reset`) e `LinkButton` "Voltar ao início" (`/painel`); nunca mostra `error.message`; `console.error` só com `error.digest`.
- `painel/not-found.tsx`: `requireTenant()` + `PainelFrame` título "Não encontrado", `EmptyState` "Não achamos o que você procurou" / "Pode ter sido removido ou estar desligado nesta loja." + `LinkButton` "Voltar ao início".
- `app/error.tsx` e `global-error.tsx`: `EntryScreen` da marca (o global com `<html lang="pt-BR"><body>` e as fontes), mesmos textos, ação "Ir para o início" (`/`). `not-found.tsx` raiz: `EntryScreen` "Página não encontrada" + "Ir para o início".

- [ ] **Step 1: Teste que falha** `painel-error.test.tsx`: `test('mostra o título e a ação; "Tentar de novo" chama reset')`, `test('nunca mostra a mensagem do erro')` (`new Error('segredo@x.com')` não aparece), `test('not-found raiz tem o link "Ir para o início"')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** `npm run typecheck && npx vitest run tests/unit/painel-error.test.tsx` → PASS.
- [ ] **Step 5: Commit** `feat: telas de erro e não encontrado no painel`.

### Tarefa 10: Carregamento e espera em todo envio

**Files:**
- Create: `src/ui/components/SubmitButton.tsx` (+ export), `tests/unit/painel-loading.test.ts`, `tests/unit/ui/SubmitButton.test.tsx`; `loading.tsx` com `ShellSkeleton variant="detail"` em `src/app/app/painel/{clientes/novo,equipe/novo,banners/novo,banners/[id],fidelidade/premios/novo,fidelidade/premios/[id],loja/produtos/novo,loja/produtos/[id],loja/pedidos/[id]}/`
- Modify: `src/ui/components/{AvatarUpload,SearchBar}.tsx`, `src/app/app/painel/_lib/{ImagemUpload,SairDaConta,EncerrarSuporte}.tsx`, `src/app/app/painel/loja/ProdutoImagens.tsx`, `src/app/app/painel/configuracoes/page.tsx` (logo), `src/app/app/painel/relatorios/page.tsx` (período)

**Interfaces:**
- `SubmitButton(props: Omit<ButtonProps, 'loading' | 'type'>)` — `type="submit"`, `loading={useFormStatus().pending}`.
- Troca para `SubmitButton`: "Enviar foto"/"Remover" (`AvatarUpload`), "Enviar imagem"/"Remover imagem" (`ImagemUpload`), subir/descer/remover em `ProdutoImagens` (cada botão no seu formulário), "Enviar logo"/"Remover logo", "Buscar" (`SearchBar`), "Ver período" (relatórios), "Sair", "Encerrar suporte".
- `SearchBar` e o filtro de período de relatórios passam de `<form method="get">` para `Form` de `next/form` (navegação do cliente: transição de página e `loading.tsx` valem).

- [ ] **Step 1: Testes que falham.** `painel-loading.test.ts`: `test('toda pasta de src/app/app/painel com page.tsx tem loading.tsx')` (percorre a árvore; sem exceções). `SubmitButton.test.tsx`: com `vi.mock('react-dom', …)` devolvendo `pending: true` → botão `disabled` com `aria-busy="true"` e "Aguarde…"; `pending: false` → habilitado. `tests/unit/painel-links.test.ts` continua verde.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** `npm run typecheck && npx vitest run tests/unit/painel-loading.test.ts tests/unit/ui/SubmitButton.test.tsx tests/unit/ui` → PASS.
- [ ] **Step 5: Commit** `feat: esqueleto em toda tela do painel e espera em todo envio`.

### Tarefa 11: Movimento só com transform/opacity, toque e foco

**Files:**
- Create: `tests/setup/css-scan.ts`, `tests/unit/motion-css.test.ts`
- Modify: `src/ui/styles/{motion,planner,controls,shells,feedback,data}.css`, o componente que posiciona `.af-planner__preview` (`src/ui/components/PlannerDay.tsx` ou `src/ui/components/planner/*`: passa `--y` em vez de `top`)

**Interfaces:**
- `tests/setup/css-scan.ts`: `scanCss(source: string): { selector: string; prop: string; value: string; line: number; media: string[] }[]` (declarações com a pilha de `@media` em volta, por contagem de chaves, comentários ignorados) e `keyframes(source): Record<string, string[]>` (propriedades usadas em cada `@keyframes`).
- Correções (achadas na leitura):
  - `planner.css` `.af-planner__preview { transition: top … }` → posição por `transform: translateY(var(--y))`, transição de `transform` (o componente passa `--y` em vez de `top`).
  - `planner.css` `.af-slip { transition: transform 120ms ease-out }` → dentro de `no-preference` com `var(--af-dur-fast) var(--af-ease)`.
  - `controls.css` `.af-timechip { transition: background-color … }` e `.af-switch__track` (`background-color`) → saem; `.af-switch__knob` (`translate`) → dentro de `no-preference` com os tokens.
  - `shells.css` `.af-navlink { transition: background-color … }` → sai (código morto); `.af-skip` → tokens.
  - `motion.css` (`transition-property: background-color, border-color, color`) → só `transform`.
  - `feedback.css` `af-rise` → `var(--af-dur)`/`var(--af-ease)`.
  - Toque: acrescentar à lista de `:active { transform: scale(.98) }` de `motion.css`: `.af-planner__tab`, `.af-planner__gap`, `.af-pick__item`, `.af-timechip`, `.af-week__day:has(.af-week__link:active)`, `.af-datalist__table tr:has(.af-row-hit:active)`.
  - Foco: `tr:has(.af-row-hit:focus-visible)` e `.af-week__day:has(.af-week__link:focus-visible)` com `outline: 3px solid var(--accent)`; `padding-block: 6px` em `.af-planner__tabs` e `.af-tabs` (o anel não é cortado pela rolagem).
  - Linha de lista em modo cartão: `:hover` com `var(--brand-tint)` (hoje igual ao fundo).

- [ ] **Step 1: Teste que falha** `motion-css.test.ts`, sobre todos os `src/ui/styles/*.css`:
  - `test('toda transition/animation diferente de none fica dentro de @media (prefers-reduced-motion: no-preference)')`
  - `test('transition só de transform, opacity, translate ou scale')`
  - `test('@keyframes só mexem em transform, opacity, translate ou scale')`
  - `test('durações de transition e animation usam var(--af-dur…)')`
  Sem lista de exceções.
- [ ] **Step 2:** → FAIL (aponta seletor e linha). **Step 3:** Corrigir. **Step 4:** `npm run typecheck && npx vitest run tests/unit/motion-css.test.ts tests/unit/ui tests/unit/agenda-layout.test.ts` → PASS.
- [ ] **Step 5: Commit** `style: movimento só com transform e opacity, toque e foco no painel`.

### Tarefa 12: Estados vazios que levam à ação e buscas que respondem

**Files:**
- Modify: `src/app/app/painel/page.tsx` (linhas de "Mais hoje" e "Próximo atendimento" viram links `/painel/agenda?data=<data>&ag=<id>`), `src/app/app/painel/agenda/{AgendaPainel,HorarioFields,BookingSheet}.tsx`, `src/app/app/painel/clientes/{page.tsx,[id]/page.tsx}`, `src/app/app/painel/equipe/FichaForms.tsx`, `src/app/app/painel/servicos/ServicosPainel.tsx`, `src/app/app/painel/fidelidade/FidelidadePainel.tsx`, `src/app/app/painel/loja/{page.tsx,PedidosLista.tsx}`
- Test: `tests/unit/ui/HorarioFields.test.tsx`, `tests/unit/ui/BookingSheetBusca.test.tsx`, `tests/integration/painel-empty-states.test.ts`

**Interfaces / correções:**
- `HorarioFields`: ao mudar dia, serviços, pet ou duração, limpa os horários e mostra "Buscando horários…" (`aria-live="polite"`) sem chips antigos; falha (`.catch`) → `role="alert"` "Não deu para buscar os horários." + `Button` "Tentar de novo".
- `BookingSheet` (busca de cliente): limpa resultados ao mudar o termo, mostra "Buscando…" (`aria-live="polite"`), `.catch` com "Tentar de novo"; botão "Cadastrar {termo}" vira "Cadastrar cliente" (com o termo como valor inicial do nome).
- `AgendaPainel`: "Nenhum profissional na agenda deste dia." ganha, com `manage_team`, `LinkButton` "Cadastrar profissional" (`/painel/equipe/novo`).
- Clientes: aba Arquivados/Clube vazia sem busca → "Nenhum cliente arquivado" / "Nenhum cliente no clube" + "Ver ativos" (`/painel/clientes`); ficha sem atendimentos (não arquivado) → `LinkButton` "Marcar horário" (`/painel/agenda?acao=marcar`).
- Equipe: dica "Cadastre os serviços da conta primeiro…" com link para `/painel/servicos`.
- Serviços arquivados vazio → "Ver serviços em uso" (`/painel/servicos`).
- Fidelidade: membros do clube vazio → "Abrir clientes" (`/painel/clientes`); resgates vazio → "Ver prêmios" (`/painel/fidelidade`).
- Loja: "Nenhum pedido ainda" → "Ver produtos" (`/painel/loja?aba=produtos`); `PedidosLista` com `onRowClick` para `/painel/loja/pedidos/<id>` (linha inteira tocável, como Clientes).

- [ ] **Step 1: Testes que falham.** `HorarioFields.test.tsx` (`consultas` mockado): `test('trocar o dia some com os horários antigos e mostra "Buscando horários…"')`, `test('falha mostra "Tentar de novo" e tentar busca de novo')`. `BookingSheetBusca.test.tsx`: `test('busca mostra "Buscando…", limpa resultados antigos e o botão diz "Cadastrar cliente"')`. `painel-empty-states.test.ts` (páginas renderizadas como em `painel-home.test.ts`): aba Arquivados vazia mostra "Nenhum cliente arquivado" e "Ver ativos"; ficha sem atendimentos mostra "Marcar horário"; Início com atendimento hoje tem link com `ag=`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** `npm run typecheck && npx vitest run` nos três arquivos + `tests/unit/painel-links.test.ts tests/integration/painel-home.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: estados vazios com ação e buscas da agenda que respondem`.

**G4 termina:** `npm run typecheck && npx vitest run <testes tocados em 9–12>`.

---

## G5 — Publicação e verificação

### Tarefa 13: `PUBLICACAO.md`, documentação e verificação completa

**Files:**
- Modify: `docs/PUBLICACAO.md`, `docs/ARQUITETURA.md`, `README.md` (só se citar o que mudou), `docs/superpowers/pendencias-proximas-fases.md`, `scripts/smoke-pages.ts`
- Test: suíte inteira

- [ ] **Step 1: `docs/PUBLICACAO.md`** (enxuto, sem histórico), seções nesta ordem:
  1. **Antes de publicar — conferências só de leitura na produção** (se vier linha diferente do esperado, parar e falar com o dono):
     ```sql
     SELECT slug, status FROM businesses;  -- esperado: só demo
     SELECT slug FROM businesses WHERE slug IN ('entrar','sair','conta','convite','cadastro','esqueci-a-senha','redefinir-senha','definir-senha','google','painel','webhooks','arquivos','brand','healthz','api','dev','admin','www','suporte','app','ajuda','termos','privacidade');  -- esperado: nenhuma
     SELECT c.email, count(*) FROM customers c WHERE c.password_hash IS NOT NULL GROUP BY c.email;  -- esperado: 1 (demo)
     SELECT count(*) FROM users u JOIN memberships m ON m.user_id = u.id AND m.active GROUP BY u.id HAVING count(*) > 1;  -- esperado: nenhuma
     ```
     (rodar antes de aplicar as migrações novas: a de `password_hash` usa a coluna que a fase 1 remove).
  2. **Domínios no Coolify:** `app.agendaflui.com.br` (todas as rotas), `painel.agendaflui.com.br` só com `LEGACY_PAINEL_HOST` (redireciona 308), remover o domínio `api.agendaflui.com.br` do recurso e o registro DNS depois de uma semana; `dev.` como hoje.
  3. **Variáveis:** `APP_HOST=app.agendaflui.com.br`, `LEGACY_PAINEL_HOST=painel.agendaflui.com.br`, `DEV_HOST`; apagar `PAINEL_HOST`, `API_HOST`, `APP_WEB_URL`, `APP_WEB_ORIGINS`, `EXPO_ACCESS_TOKEN`.
  4. **Mercado Pago:** webhook em `https://app.agendaflui.com.br/webhooks/mercadopago/<chave>` (a URL aparece em Contas → Integrações no dev).
  5. **Google Cloud (uma vez):** projeto; ativar "Google Calendar API"; tela de consentimento OAuth "Externo" com nome Agenda Flui, logo, e-mail de suporte, domínio autorizado `agendaflui.com.br`, links de privacidade e termos, escopos `openid`, `email`, `profile` e `https://www.googleapis.com/auth/calendar.events`; credencial "ID do cliente OAuth" tipo "Aplicativo da Web" com URI de redirecionamento `https://app.agendaflui.com.br/google/retorno` (copiar de Sistema → Google); colar ID e chave em Sistema → Google no dev. **Status de publicação "Em produção"**: em "Teste" o token de renovação vence em 7 dias e a agenda desliga sozinha. **Verificação:** `calendar.events` é escopo sensível; até o Google verificar o app, quem liga a agenda vê "O Google não verificou este app" (seguir por "Avançado") e o projeto fica limitado a 100 pessoas; pedir a verificação (vídeo mostrando o uso da permissão, domínio verificado no Search Console) quando houver lojas de verdade. Entrar com Google (só `email`/`profile`) não precisa de verificação.
  6. **Depois de publicar:** `npm run demo:create -- --recriar` no terminal do contêiner (as senhas aparecem uma vez, só ali); conferir `/healthz`, `/entrar`, `/demo`, o redirecionamento de `painel.` e, no dev, Sistema → Google e as execuções `calendar` em Sistema.
- [ ] **Step 2: `docs/ARQUITETURA.md`:** seção "Google Agenda" (tabelas, geração/reconciliação, id determinístico, espera e revogação, leitor restrito `calendar/token.ts`, ligar/desligar), "Começo do dono" (progresso, redirecionamento só do Início, contas sem linha), tarefa `calendar` do agendador. `pendencias-proximas-fases.md`: lista do que o dono confere no navegador nesta fase (ligar a agenda com `/google/falso`, desligar, revogar; começo inteiro com pular, voltar e dispensar; demo recriada; telas de erro; movimento com e sem "reduzir movimento"; 360 px).
- [ ] **Step 3: Fumaça.** `scripts/smoke-pages.ts` ganha `/painel/comecar` (dono da demo: redireciona para `/painel`, já concluída), `/conta` com a seção da agenda e uma URL inexistente sob `/painel` (tela nova de não encontrado). Rode `npm run smoke` com o banco local; se não subir, registre.
- [ ] **Step 4: Varreduras.** `rg -n -i "tutor|tosador|patinhas" src scripts` sem texto de tela novo; `rg -n "API do app|api\.agendaflui" src scripts docs/ARQUITETURA.md` vazio (fora de `PUBLICACAO.md`, que manda remover o domínio).
- [ ] **Step 5: Verificação completa.** `npm run typecheck && npm run lint && npm test && npm run build` → tudo verde, sem aviso novo.
- [ ] **Step 6: Commit** `docs: publicação com Google Agenda e começo do dono`.

**G5 termina** com o Step 5 verde; depois, a revisão final única sobre o ramo inteiro, guiada pela Review Focus.
