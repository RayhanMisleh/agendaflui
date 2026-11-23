# Entrada pelo link, equipe no app, sem vouchers e fluidez — painel e API — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O painel e a API passam a vender o produto como o dono quer: sem vouchers, termos "Clientes", uma loja por login da equipe com entrada única e cadastro com convite de verdade, link e QR para clientes, login da equipe no app sem escolher loja (com avisos de toda a loja para dono e gerente), demo com cara de cliente real e telas fluidas e responsivas.

**Architecture:** A ordem do design: D (vouchers) e E (termos) limpam primeiro; B muda acesso e convite no núcleo compartilhado `src/server/domain/platform/access-core.ts` e na entrada do painel; A acrescenta `APP_WEB_URL` e a área "Link para clientes"; C muda só a rota de login da equipe da API e acrescenta a preferência de avisos por vínculo; G refaz a marca da demo; F mexe em CSS, molduras e `loading.tsx` por último. Cada tarefa deixa o repositório verde (`typecheck`, `lint`, `test`, `build`).

**Tech Stack:** Next.js 16 (App Router, `<ViewTransition>` do React do Next), TypeScript estrito, Prisma 7, PostgreSQL, Vitest, sharp, nodemailer. Entra: `qrcode` (+ `@types/qrcode`).

**Spec:** `docs/superpowers/specs/2026-11-23-entrada-equipe-app-design.md` (manda em tudo). Regras do repositório: `AGENTS.md`. Arquitetura: `docs/ARQUITETURA.md`. O plano do app (`../app/docs/superpowers/plans/2026-11-23-entrada-equipe-app.md`) consome os contratos das Tarefas 2, 10 e 11.

## Global Constraints

- Regras do `AGENTS.md` valem em toda tarefa: regra de negócio só em `src/server/`; dados de conta só por `tenantDb`/`ctx.db`; domínio usa `ctx.clock()`, nunca `new Date()`; esquemas importam `z` de `@/server/domain/errors`; datas só por `src/server/time/`; travas só por `$lockKey`/`lockKeyRaw`; hosts só por `hostConfigFromEnv`/`areaLink`; sem `any` nem `@ts-ignore`.
- Migração nova sempre em pasta nova `prisma/migrations/<AAAAMMDDhhmmss>_<nome>/migration.sql`, escrita à mão; nunca editar migração antiga. Índice parcial vive só na migração, com comentário no `schema.prisma` (padrão já usado no arquivo). Os testes aplicam as migrações sozinhos (`tests/setup/global-db.ts`).
- Textos de interface em pt-BR, voz da marca: frase curta, verbo na frente, "você". "Agenda Flui" escrito assim. Termos da conta (`terms`) nunca fixos em tela.
- Anti-metas que nenhuma tarefa pode deixar: "Tutor"/"Tutores", "voucher" ou o link de entrada da equipe (`/entrar/<slug>`, `/escolher-conta`) em qualquer tela; cliente vendo outra loja; profissional vendo agenda ou cliente de colega quando o papel não permite; convite que não chega sem ninguém perceber; animação que trava rolagem ou ignora "reduzir movimento".
- Uma loja por login da equipe conta só vínculos ATIVOS (`memberships.active`). Admins da plataforma (`platform_admins`) ficam fora da regra.
- Credenciais (Resend, push Apple/Google, banco de produção) são do dono: nada de segredo no código, no `.env.example` (só o nome da variável comentado) nem em teste.
- Movimento: só `transform` e `opacity`, 150–250 ms, só em resposta a ação ou para mostrar o que mudou; tudo dentro de `@media (prefers-reduced-motion: no-preference)` ou anulado em `reduce`.
- Sem testes de navegador: não rode nem escreva Playwright/e2e (`tests/e2e/**` fica como está). Sem abrir navegador para conferir tela.
- Verificação padrão (último passo de toda tarefa), dentro de `painel/`: `npm run typecheck && npm run lint && npm test && npm run build`. Esperado: tudo verde, sem aviso novo. Tarefas que mexem em página também rodam `npm run smoke` quando o banco local estiver de pé (`npm run db:start`); se não estiver, registre no relatório que não rodou.
- Commits locais em português, no formato `tipo: descrição`, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push. Não commite o bloco gerado pelo `next dev` no `AGENTS.md` se ele aparecer só como ruído.
- Documentação enxuta: atualize só as linhas que ficaram erradas (`README.md`, `docs/ARQUITETURA.md`, `docs/PUBLICACAO.md`, `.env.example`, `docs/superpowers/pendencias-proximas-fases.md`); sem histórico, sem doc novo.

## Review Focus

1. **Convite para e-mail que já é da equipe de outra loja** (inclusive dois convites simultâneos, reativação de vínculo antigo e criação de conta no painel dev com dono que já é de outra loja): `conflict` com a frase `OUTRA_LOJA_MESSAGE`, nada gravado; a corrida é barrada pelo índice `memberships_one_active_per_user` e vira a mesma resposta. Testes na Tarefa 5.
2. **Login da equipe no app sem loja**: e-mail inexistente, senha errada, sem senha, vínculo desativado → a mesma 401 `invalid_credentials`; conta suspensa → 503 `business_unavailable` só depois da senha certa; `X-Business` de outra loja é ignorado; o limite de tentativas vale por e-mail+IP sem depender de loja. Testes na Tarefa 10.
3. **Convite que não sai** (sem canal configurado, SMTP/Resend recusando): o cadastro fica, a ficha e a lista mostram "Convite não enviado" com "Reenviar"; reenviar com sucesso volta para "Convite enviado". Testes na Tarefa 8.
4. **Banco com pedidos de voucher na migração de remoção** (pedido só de voucher, pedido misto, código já usado): migração passa, nenhum item fica sem produto, pedido só de voucher some com pagamento e eventos, pedido misto fica só com os produtos. Conferência na Tarefa 3.
5. **Avisos de toda a loja**: profissional não consegue ligar a preferência (403); dono que também é o profissional do atendimento recebe um aviso só; gerente rebaixado ou desativado depois de ligar não recebe mais. Testes na Tarefa 11.

## Nota do coordenador antes do deploy (não é tarefa do executor)

Antes de publicar qualquer versão que contenha a Tarefa 3 ou a Tarefa 5, o coordenador consulta o banco de produção, **somente leitura**:

```sql
-- Tarefa 5: usuários com mais de um vínculo ativo (a migração do índice único falha se houver)
SELECT user_id, count(*) FROM memberships WHERE active GROUP BY user_id HAVING count(*) > 1;
-- Tarefa 3: pedidos com voucher fora da conta de demonstração (a migração os apaga ou corta)
SELECT b.slug, count(DISTINCT oi.order_id) FROM order_items oi JOIN businesses b ON b.id = oi.business_id
WHERE oi.voucher_id IS NOT NULL GROUP BY b.slug;
```

Se a primeira consulta devolver linhas, ou a segunda devolver conta que não seja `demo`, o coordenador para e pergunta ao dono antes do deploy. Reimplantar no servidor só com o sim do dono.

---

## Parte D — Remover vouchers

### Task 1: Telas do painel do negócio e rotas da API de vouchers saem

**Files:**
- Create: `tests/unit/sem-vouchers.test.ts`, `tests/setup/varredura.ts` (ajudante `arquivosCom`)
- Delete: `src/app/painel/(app)/vouchers/**`, `src/app/api/v1/vouchers/**`, `src/app/api/v1/me/voucher-codes/route.ts`, `src/server/api/schemas/vouchers.ts`, `tests/integration/api/voucher-routes.test.ts`, `tests/integration/painel-vouchers-actions.test.ts`
- Modify: `src/server/api/routes-manifest.ts`, `src/app/painel/(app)/PainelFrame.tsx` (`ROTAS_PRONTAS`), `src/ui/shells/painel-nav.ts`, `src/ui/styles/painel.css`, `src/app/painel/(app)/loja/pedidos/[id]/page.tsx`
- Test: `tests/unit/sem-vouchers.test.ts`, e os testes que citam essas telas e rotas (`openapi.test.ts`, `public-routes.test.ts`, `painel-nav.test.ts`, `painel-guards.test.ts`)

**Interfaces:**
- Produces: `tests/unit/sem-vouchers.test.ts` com a lista `PASTAS` que as Tasks 2 e 3 ampliam. O domínio (`src/server/domain/vouchers/**`, `domain/store/*`) e as rotas da loja (`src/app/api/v1/store/**`) ainda não mudam.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sem-vouchers.test.ts — varre o código: nenhuma menção a voucher/parceiro de voucher.
const PASTAS = ['src/app/painel', 'src/app/api', 'src/ui', 'src/server/api/routes-manifest.ts']
const EXCETO = ['src/app/api/v1/store'] // a loja muda junto com o domínio, na Task 2
test('nenhum arquivo das pastas varridas cita voucher', () => {
  expect(arquivosCom(/voucher/i, PASTAS, EXCETO)).toEqual([])
})
```

`arquivosCom(re: RegExp, caminhos: string[], exceto?: string[]): string[]` em `tests/setup/varredura.ts` percorre arquivos e pastas recursivamente com `node:fs` e devolve `caminho:linha` de cada ocorrência. O painel dev fica para a Task 2 (os formulários de módulos dependem de `MODULE_NAMES`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sem-vouchers.test.ts`
Expected: FAIL listando os arquivos de `src/app/painel/(app)/vouchers`, rotas e esquemas.

- [ ] **Step 3: Remover telas, rotas e esquemas**

Apague os arquivos listados; tire as rotas do manifesto, o item "Vouchers" da navegação e de `ROTAS_PRONTAS`, os estilos `af-voucher*` do `painel.css` e os códigos de voucher da tela do pedido.

- [ ] **Step 4: Ajustar os testes que citavam as telas e rotas e rodar**

Run: `npx vitest run tests/unit/sem-vouchers.test.ts tests/integration/api/openapi.test.ts tests/unit/painel-nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação padrão e commit**

```bash
git add -A src tests
git commit -m "refactor: telas e rotas de vouchers saem do painel e da API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Domínio, módulo, capacidade, seed e demo sem vouchers

**Files:**
- Delete: `src/server/domain/vouchers/**`, `tests/integration/{vouchers,voucher-codes-race,voucher-orders}.test.ts`, `tests/unit/voucher-code-format.test.ts`, `tests/setup/vouchers.ts`
- Modify: `src/app/dev/(app)/contas/[id]/{FormsConta.tsx,actions.ts,forms.ts,modulos/page.tsx}`, `src/app/dev/(app)/contas/nova/{Wizard.tsx,actions.ts,fields.ts}`, `src/server/domain/store/{cart,orders,order-events,checkout,payments,shipping}.ts`, `src/app/api/v1/store/{orders,shipping-quotes}/route.ts`, `src/server/api/schemas/store.ts`, `src/shared/modules.ts`, `src/server/auth/capabilities.ts`, `src/server/domain/platform/{public-business,businesses,customization,module-usage}.ts`, `src/server/api/booking-schemas.ts` (`businessSchema.modules`), `prisma/seed.ts`, `prisma/seed-data.ts`, `scripts/demo-create.ts`, `scripts/demo-data.ts`, `scripts/smoke-pages.ts`, `README.md`, `docs/ARQUITETURA.md`, `docs/PUBLICACAO.md`, `docs/superpowers/pendencias-proximas-fases.md`
- Test: `tests/unit/sem-vouchers.test.ts` (amplia `PASTAS`), `tests/unit/capabilities.test.ts`, `tests/unit/{dev-account-modules-form.test.tsx,dev-wizard-fields.test.ts}`, `tests/integration/{dev-account-actions,dev-create-account-action,modules,module-usage,platform-businesses,platform-customization,payment-review-fixes,seed,settings-versions,painel-home}.test.ts`, `tests/integration/api/staff-auth.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `MODULE_NAMES = ['loyalty', 'banners', 'store']`; `Capability` sem `'manage_vouchers'`; `CartLine = { productId: string; quantity: number }`; linhas do corpo de `POST /v1/store/orders` e `POST /v1/store/shipping-quotes` = `{ productId: string; quantity: number }` (`productId` obrigatório) e entrega sem a opção `NONE`; `OrderView.items[].kind: 'product'` (`z.literal('product')` no esquema); `GET /v1/business` → `modules: { loyalty: boolean; banners: boolean; store: boolean }` (o app lê só isso). Os modelos Prisma `Partner`, `Voucher`, `VoucherCode` e as colunas continuam no schema até a Task 3 (ninguém os usa).

- [ ] **Step 1: Ampliar a varredura (falha)**

`PASTAS = ['src', 'scripts', 'prisma/seed.ts', 'prisma/seed-data.ts', 'tests/unit', 'tests/integration', 'tests/setup', 'README.md', 'docs/ARQUITETURA.md', 'docs/PUBLICACAO.md']`, com exceção só de `src/server/db/generated/**` e do próprio `sem-vouchers.test.ts`.

Run: `npx vitest run tests/unit/sem-vouchers.test.ts` — Expected: FAIL listando domínio, seed, demo, smoke e testes.

- [ ] **Step 2: Remover do painel dev, do domínio, módulos, capacidade, seed, demo e fumaça**

Painel dev: o interruptor e os textos de vouchers saem da aba Módulos e do assistente de nova conta. Carrinho, pedido, eventos do pedido e checkout ficam só com produto. Pedido sem item físico deixa de existir: a regra de entrega `NONE` some do domínio (o valor do enum `DeliveryMethod` fica no banco, sem uso). A demo perde a seção de parceiros/vouchers e os pedidos com voucher (`DEMO_PARCEIROS` e as linhas `voucher` de `demo-data.ts`); o seed também. Docs: só as linhas que citam vouchers.

- [ ] **Step 3: Ajustar os testes existentes**

"Quatro capacidades de módulo" vira três; listas de módulos sem `vouchers`. Run: `npx vitest run tests/unit/sem-vouchers.test.ts tests/unit/capabilities.test.ts tests/integration/modules.test.ts`
Expected: PASS.

- [ ] **Step 4: Verificação padrão e commit** (`refactor: vouchers saem do domínio, do seed e da demo`)

### Task 3: Migração que apaga vouchers do banco

Revisão: Opus

**Files:**
- Create: `prisma/migrations/20261123030000_remove_vouchers/migration.sql`
- Modify: `prisma/schema.prisma` (saem `Partner`, `Voucher`, `VoucherCode`, `VoucherCodeStatus`, as relações em `Business`, `Upload`, `Customer`, `Order`, `OrderItem.voucherId`/`voucher`/`codes`, `BusinessModules.vouchers`), `src/server/db/models.ts`, `tests/setup/fks.ts` (se listar FKs de voucher), `tests/integration/schema.test.ts` (sai "vouchers sem loja é recusado pelo banco")
- Test: `tests/unit/sem-vouchers.test.ts` (acrescenta `prisma/schema.prisma` e `src/server/db/models.ts` a `PASTAS`)

**Interfaces:**
- Consumes: Task 2 (nenhum código usa os modelos).
- Produces: banco sem `partners`, `vouchers`, `voucher_codes`, `voucher_code_status`, `order_items.voucher_id`, `business_modules.vouchers`; `order_items_one_target_check` volta a ser `CHECK ("product_id" IS NOT NULL)` (como antes de `20261119070000_vouchers`).

- [ ] **Step 1: Ampliar a varredura (falha)** — Run: `npx vitest run tests/unit/sem-vouchers.test.ts` — Expected: FAIL em `schema.prisma` e `models.ts`.

- [ ] **Step 2: Escrever a migração**, nesta ordem, numa transação (o Prisma já a envolve):
  1. Guardar os ids de upload usados só por `partners.logo_upload_id` e `vouchers.image_upload_id` (tabela temporária).
  2. `DELETE FROM voucher_codes`.
  3. Apagar os pedidos em que todo item é voucher (`orders` com itens e nenhum `product_id`), confiando nas cascatas de `payments`, `order_items` e eventos; se algum filho do pedido não tiver `ON DELETE CASCADE`, apague-o antes, explicitamente.
  4. `DELETE FROM order_items WHERE voucher_id IS NOT NULL` (pedidos mistos ficam só com os produtos; os totais gravados do pedido não mudam).
  5. Derrubar FKs, índice e coluna `order_items.voucher_id`; trocar `order_items_one_target_check` pela regra só de produto.
  6. `DROP TABLE voucher_codes, vouchers, partners`; `DROP TYPE voucher_code_status`.
  7. `ALTER TABLE business_modules DROP CONSTRAINT business_modules_vouchers_need_store, DROP COLUMN vouchers`.
  8. Apagar as linhas de `uploads` do passo 1 que nenhuma outra tabela usa (os arquivos no disco ficam; registre uma linha em `docs/superpowers/pendencias-proximas-fases.md`).

- [ ] **Step 3: Conferir a migração com dados (banco local, descartável)**

Antes de aplicar, com o banco local ainda no estado da Task 2 (`npm run db:start`; se ele não tiver as tabelas de voucher, `npm run db:reset` no commit da Task 2 resolve), grave por SQL avulso (arquivo fora do repositório) numa conta qualquer: um parceiro, um voucher, um pedido só de voucher com pagamento e código, um pedido misto (produto + voucher) com código usado. Depois:

Run: `npm run db:migrate` e, com `psql`, `SELECT count(*) FROM order_items WHERE product_id IS NULL;` e a contagem de pedidos.
Expected: migração aplicada sem erro; `0` itens sem produto; o pedido só de voucher e o pagamento dele sumiram; o pedido misto ficou com 1 item.

- [ ] **Step 4: Schema e testes** — Run: `npx prisma generate && npx vitest run tests/unit/sem-vouchers.test.ts tests/integration/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação padrão e commit** (`feat: migração apaga vouchers do banco`)

## Parte E — Termos

### Task 4: "Clientes" em todos os padrões

**Files:**
- Create: `tests/unit/sem-tutor.test.ts`
- Modify: `prisma/seed-data.ts`, `scripts/demo-create.ts`, `src/app/dev/(app)/contas/nova/fields.ts` (modelo pet shop), `src/app/dev/vitrine/{Vitrine.tsx,BrandSection.tsx}`, `src/ui/shells/painel-nav.ts` (comentário)
- Test: `tests/unit/dev-wizard-fields.test.ts`, `tests/integration/seed.test.ts`

**Interfaces:**
- Produces: modelo pet shop do assistente com `customerSingular: 'Cliente'`, `customerPlural: 'Clientes'`. Testes que só usam "Tutor" como termo personalizado de entrada (editabilidade) podem ficar.

- [ ] **Step 1: Write the failing test** — `expect(arquivosCom(/tutor/i, ['src', 'prisma', 'scripts'])).toEqual([])` (`arquivosCom` de `tests/setup/varredura.ts`, da Task 1).
- [ ] **Step 2: Run** `npx vitest run tests/unit/sem-tutor.test.ts` — Expected: FAIL em seed, demo, fields, vitrine, painel-nav.
- [ ] **Step 3: Trocar** os padrões por Cliente/Clientes e os textos de exemplo da vitrine por "cliente"; ajustar `dev-wizard-fields.test.ts` (`pet.terms.customerSingular` = `'Cliente'`) e o `seed.test.ts`.
- [ ] **Step 4: Run** os três testes — Expected: PASS.
- [ ] **Step 5: Verificação padrão e commit** (`fix: termo padrão é Clientes em todos os modelos`)

## Parte B — Equipe: entrada, convite e e-mail

> Lembrete: a Nota do coordenador (acima) vale antes do deploy da Task 5.

### Task 5: Uma loja por login da equipe

Revisão: Opus

**Files:**
- Create: `prisma/migrations/20261123040000_um_vinculo_ativo/migration.sql`
- Modify: `prisma/schema.prisma` (comentário no `Membership`), `src/server/domain/platform/access-core.ts` (`convidar`, `alterarVinculoEm`), `src/server/domain/platform/businesses.ts` (`createBusiness`), `prisma/seed.ts`, `prisma/seed-data.ts` (sai `DEMO_MULTI_NOME` e `SEED_MULTI_EMAIL`), `docs/ARQUITETURA.md` ("um usuário pode ter várias contas" vira "uma loja por login da equipe")
- Test: `tests/integration/team-access.test.ts`, `tests/integration/platform-team.test.ts`, `tests/integration/platform-businesses.test.ts`, `tests/integration/seed.test.ts`, `tests/integration/auth.test.ts` e os demais que criarem dois vínculos ativos para o mesmo usuário (rode a suíte inteira para achá-los)

**Interfaces:**
- Produces: `export const OUTRA_LOJA_MESSAGE = 'Este e-mail já faz parte da equipe de outra loja. Cada acesso da equipe pertence a uma loja só.'` em `access-core.ts`; erro `DomainError('conflict', OUTRA_LOJA_MESSAGE, { reason: 'member_of_other_business', fields: { email: OUTRA_LOJA_MESSAGE } })` em `convidar`, `createBusiness` (campo `owner.email`) e ao reativar vínculo em `alterarVinculoEm` (sem `fields`). Índice `memberships_one_active_per_user`.

- [ ] **Step 1: Write the failing tests** (em `team-access.test.ts`, `platform-team.test.ts`, `platform-businesses.test.ts`):

```ts
test('convidar quem é ativo em outra loja: conflict member_of_other_business, nada gravado', ...)
  // expect(domainError(...)).toMatchObject({ code: 'conflict', reason: 'member_of_other_business' }); vínculos do usuário = 1
test('quem foi desativado na loja A pode ser convidado na B; reativar na A depois é recusado', ...)
test('dois convites simultâneos do mesmo e-mail em lojas diferentes: um passa, o outro é conflict com a mesma frase', ...)
  // Promise.allSettled das duas chamadas
test('criar conta no painel dev com dono ativo em outra loja: conflict no campo owner.email', ...)
test('o banco recusa um segundo vínculo ativo do mesmo usuário', ...)
  // prisma.membership.create direto → rejects (violação de unicidade)
```

- [ ] **Step 2: Run** `npx vitest run tests/integration/team-access.test.ts tests/integration/platform-team.test.ts tests/integration/platform-businesses.test.ts` — Expected: FAIL nos casos novos.

- [ ] **Step 3: Migração** — um bloco `DO $$ ... $$` que, se `SELECT user_id FROM memberships WHERE active GROUP BY user_id HAVING count(*) > 1` achar algo, faz `RAISE EXCEPTION 'Há usuários com mais de um vínculo ativo; resolva antes de aplicar (veja o plano 2026-11-23, Nota do coordenador).'`; depois `CREATE UNIQUE INDEX "memberships_one_active_per_user" ON "memberships"("user_id") WHERE "active";`.

- [ ] **Step 4: Regra no domínio** — dentro da transação, antes de criar ou reativar o vínculo, conferir outro vínculo ativo do usuário em outra conta; a violação do índice novo (corrida) vira o mesmo `conflict` (distinga-a da unicidade `(business_id, user_id)`, que continua com a frase atual). Seed sem o usuário de várias contas; ajuste os testes antigos que dependiam disso (o caso "quem tem duas contas escolhe" de `auth.test.ts` passa a provar que o login traz no máximo um vínculo).

- [ ] **Step 5: Run** a suíte inteira (`npm test`) — Expected: PASS.

- [ ] **Step 6: Verificação padrão e commit** (`feat: cada login da equipe pertence a uma loja só`)

### Task 6: Entrada única da equipe

Revisão: Opus

**Files:**
- Create: `tests/unit/entrada-unica.test.ts`
- Delete: `src/app/painel/entrar/[slug]/page.tsx`, `src/app/painel/escolher-conta/{page.tsx,actions.ts}`
- Modify: `src/app/painel/entrar/{page.tsx,actions.ts}`, `src/server/auth/guards.ts` (sai `BRAND_COOKIE`/`setBrandCookie`; `requireTenant` sem conta ativa → `redirect('/entrar')`), `src/server/auth/member-auth.ts` (sai `selectBusiness`), `src/app/painel/(app)/PainelFrame.tsx` (sem "Trocar de conta"; sem marca → `/entrar`), `src/server/domain/platform/businesses.ts` (sai `entryUrl`/`entryUrlOf`), `src/server/domain/platform/access-core.ts` (aviso de acesso aponta para `areaLink('painel', '/entrar')`), `src/server/domain/settings/business-profile.ts` (sai `entryUrl`), `src/app/painel/(app)/configuracoes/{Formularios.tsx,page.tsx}`, `src/app/dev/(app)/contas/{page.tsx,ContasTable.tsx}`, `src/app/dev/(app)/contas/[id]/layout.tsx`, `src/app/dev/(app)/contas/nova/{Wizard.tsx,fields.ts,actions.ts}`, `scripts/demo-create.ts` (link impresso vira `/entrar`), `scripts/smoke-pages.ts`, `README.md`, `docs/ARQUITETURA.md`, `docs/superpowers/pendencias-proximas-fases.md` (uma linha: `tests/e2e/entrada.spec.ts` ainda cita as rotas removidas)
- Test: `tests/integration/auth.test.ts`, `tests/integration/support-session.test.ts`, `tests/integration/platform-businesses.test.ts`, `tests/integration/dev-create-account-action.test.ts`, `tests/integration/business-profile.test.ts`, `tests/integration/team-access.test.ts`, `tests/integration/platform-team.test.ts`, `tests/unit/dev-wizard.test.tsx`, `tests/unit/ui-dev-parts.test.tsx`, `tests/unit/notification-mail-actions.test.ts`

**Interfaces:**
- Consumes: Task 5 (no máximo um vínculo ativo).
- Produces: `loginMember` (server action) — 0 contas ativas → `{ error: SEM_CONTA }`; 1 → cookie de sessão e `redirect('/')`. `BusinessRow`/`BusinessDetail`/`BusinessProfile` sem `entryUrl`. A tela `/entrar` usa sempre a marca Agenda Flui.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/entrada-unica.test.ts
test('as telas de entrada por conta e de escolher conta não existem mais', ...)
  // existsSync('src/app/painel/entrar/[slug]') e 'src/app/painel/escolher-conta' → false
test('nenhum código cita /escolher-conta, BRAND_COOKIE nem link de entrada por conta', ...)
  // arquivosCom(/escolher-conta|BRAND_COOKIE|setBrandCookie|entryUrl|\/entrar\/\$\{/, ['src', 'scripts']) → []
```

Em `auth.test.ts`: `'login com uma conta ativa grava a sessão já nela'` (`activeBusinessId` = a conta) e `'requireTenant sem conta ativa manda para /entrar'` (com `redirect` simulado como em `painel-team-actions.test.ts`).

- [ ] **Step 2: Run** `npx vitest run tests/unit/entrada-unica.test.ts tests/integration/auth.test.ts` — Expected: FAIL.
- [ ] **Step 3: Remover e ajustar** os arquivos listados. O e-mail "Você ganhou acesso" leva a `…/entrar`. O assistente do painel dev perde o link de entrada (a Task 9 põe o link para clientes no lugar).
- [ ] **Step 4: Run** os testes listados — Expected: PASS.
- [ ] **Step 5: Verificação padrão (com `npm run smoke`) e commit** (`feat: entrada única da equipe, sem escolher conta`)

### Task 7: E-mail pelo Resend, e-mail de teste e convite citando o app

Revisão: Opus

**Files:**
- Create: `src/server/notifications/channels/email-resend.ts`, `tests/unit/email-resend.test.ts`, `src/app/dev/(app)/sistema/EmailDeTeste.tsx`
- Modify: `src/server/env.ts`, `src/server/notifications/channels/index.ts`, `src/server/notifications/deliver-mail.ts`, `src/server/notifications/render-invite.ts`, `src/server/notifications/render-account.ts` (`renderTestEmail`), `src/server/domain/platform/system.ts`, `src/app/dev/(app)/sistema/{actions.ts,page.tsx}`, `src/app/painel/definir-senha/[token]/DefinirSenhaForm.tsx` (frase do app na confirmação), `.env.example`, `docs/PUBLICACAO.md`
- Test: `tests/unit/email-resend.test.ts`, `tests/unit/env.test.ts` (ou o arquivo de env existente), `tests/unit/notification-mail-actions.test.ts`, `tests/integration/platform-system.test.ts` (crie se não houver teste de `system.ts`)

**Interfaces:**
- Produces:
  - `createResendChannel(apiKey: string, from: string, fetchImpl?: typeof fetch): EmailChannel` — `POST https://api.resend.com/emails`, `Authorization: Bearer <apiKey>`, corpo `{ from, to: [to], subject, text, html }` (`from` montado com `fromHeader`), tempo-limite 20 s; resposta não 2xx ou falha de rede → `throw new ChannelError('channel_error' | 'timeout')`, sem corpo da resposta na mensagem.
  - `env.RESEND_API_KEY?: string`; em produção, `RESEND_API_KEY` sem `MAIL_FROM` é erro de partida; aviso de partida quando faltam `SMTP_URL` e `RESEND_API_KEY`.
  - `getEmailChannel()`: produção usa Resend se `RESEND_API_KEY` existe, senão SMTP, senão `null`. `emailChannelKind(source?): 'resend' | 'smtp' | 'file' | 'none'`.
  - `deliverAccessMail(kind, to, mail): Promise<boolean>` (`true` só se o canal aceitou).
  - `sendTestEmail(actor: PlatformAdminActor, now: Date): Promise<TestEmailResult>` com `type TestEmailResult = { ok: boolean; channel: 'resend' | 'smtp' | 'file' | 'none'; error: ChannelErrorCode | null; to: string }` — manda para o e-mail do próprio admin e audita `system.test_email` com `{ ok, channel, error }`.
  - `APP_LINE = 'Baixe o app Agenda Flui para ver sua agenda no celular.'` exportada de `render-invite.ts`, no texto e no HTML de `renderMemberInvite`, `renderOwnerInvite` e `renderAccessGranted`.

- [ ] **Step 1: Write the failing tests**

```ts
test('Resend: manda o JSON certo com Bearer e o remetente de MAIL_FROM', ...)        // fetch falso captura a requisição
test('Resend: 4xx/5xx viram ChannelError channel_error sem o corpo da resposta', ...)
test('produção com RESEND_API_KEY usa o Resend; sem ela e com SMTP_URL, o SMTP', ...) // emailChannelKind
test('produção com RESEND_API_KEY e sem MAIL_FROM não sobe', ...)                    // parseEnv lança citando MAIL_FROM
test('convite, dono e aviso de acesso citam o app', ...)                             // texto e html contêm APP_LINE
test('e-mail de teste: chega ao admin, devolve ok e audita', ...)                   // fakeMail; auditLog action 'system.test_email'
test('e-mail de teste com canal falhando: ok false, error channel_error, auditado', ...)
```

- [ ] **Step 2: Run** os arquivos de teste — Expected: FAIL.
- [ ] **Step 3: Implementar** canal, seleção, retorno booleano, e-mail de teste (botão "Enviar e-mail de teste para mim" na página Sistema, com o resultado na tela: "E-mail enviado para <e-mail> pelo <Resend|SMTP>." ou "Não deu para enviar: <motivo em pt-BR>.") e a frase do app. `.env.example` e `PUBLICACAO.md`: `RESEND_API_KEY` comentada, com uma linha dizendo que ela substitui o SMTP e que o domínio remetente precisa estar verificado no Resend.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Verificação padrão e commit** (`feat: e-mail pelo Resend, e-mail de teste no painel dev e convite cita o app`)

### Task 8: Cadastro de profissional num passo e situação do convite

Revisão: Opus

**Files:**
- Create: `prisma/migrations/20261123050000_convite_nao_enviado/migration.sql`, `src/server/domain/team/access-status.ts`, `tests/unit/access-status.test.ts`
- Modify: `prisma/schema.prisma` (`Membership.inviteMailFailedAt DateTime? @map("invite_mail_failed_at") @db.Timestamptz(3)`), `src/server/domain/platform/access-core.ts` (`TeamMember`, `InviteInput`, `convidar`, `reenviarConvite`), `src/server/domain/platform/businesses.ts` (falha do e-mail do dono marca o vínculo), `src/server/domain/team/access.ts` (`addTeamMember`), `src/app/painel/(app)/equipe/{actions.ts,FichaForms.tsx,EquipeTabela.tsx,page.tsx,novo/page.tsx,[id]/page.tsx}`
- Test: `tests/unit/access-status.test.ts`, `tests/integration/team-access.test.ts`, `tests/integration/painel-team-actions.test.ts`, `tests/integration/platform-businesses.test.ts`

**Interfaces:**
- Consumes: Task 5 (`OUTRA_LOJA_MESSAGE`), Task 7 (`deliverAccessMail` → `boolean`).
- Produces:
  - `TeamMember.inviteMailFailed: boolean`.
  - `InviteInput.createProfessional?: boolean` — com `true`, a mesma transação cria a ficha (`professionals`, nome = `name`, ligada ao vínculo, ordem no fim da lista, comissão 0) e o vínculo; `TeamMember.professionalId` traz a ficha nova.
  - Depois do commit, `convidar` e `reenviarConvite` gravam `invite_mail_failed_at = enviado ? null : now`; o retorno reflete isso.
  - `addTeamMember(ctx: TenantContext, i: { name: string; email: string; role: 'PROFESSIONAL' | 'MANAGER' }): Promise<TeamMember>` (exige `manage_team`; papel fora da lista → `validation` no campo `role`).
  - `type AccessStatus = 'invited' | 'invite_failed' | 'active' | 'inactive' | 'none'`; `accessStatus(m: Pick<TeamMember, 'active' | 'hasPassword' | 'inviteMailFailed'> | null): AccessStatus`; `ACCESS_STATUS_LABEL: Record<AccessStatus, string>` = `invited: 'Convite enviado'`, `invite_failed: 'Convite não enviado'`, `active: 'Ativo'`, `inactive: 'Desativado'`, `none: 'Sem acesso'`.
  - Server action `cadastrarNaEquipe` (substitui `criarProfissional`): campos `name`, `email`, `role`; sucesso → `redirect('/equipe/<professionalId>')`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/access-status.test.ts
test.each([
  [{ active: false, hasPassword: true, inviteMailFailed: false }, 'inactive'],
  [{ active: true, hasPassword: true, inviteMailFailed: true }, 'active'],
  [{ active: true, hasPassword: false, inviteMailFailed: true }, 'invite_failed'],
  [{ active: true, hasPassword: false, inviteMailFailed: false }, 'invited'],
  [null, 'none'],
])('%o → %s', (m, s) => expect(accessStatus(m)).toBe(s))

// team-access.test.ts
test('addTeamMember cria ficha, vínculo e convite numa transação e manda o e-mail', ...)
test('addTeamMember com o envio falhando: cadastro fica, inviteMailFailed true', ...)          // mail.failing = true
test('reenviar com sucesso limpa a falha', ...)
test('addTeamMember com e-mail de outra loja: conflict, nem ficha nem vínculo', ...)
test('profissional não cadastra ninguém: forbidden', ...)
test('papel OWNER em addTeamMember: validation no campo role', ...)
// painel-team-actions.test.ts
test('cadastrarNaEquipe sem e-mail volta erro no campo email', ...)
test('cadastrarNaEquipe grava e vai para a ficha nova', ...)
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Migração** `ALTER TABLE "memberships" ADD COLUMN "invite_mail_failed_at" TIMESTAMPTZ(3);` e o domínio.
- [ ] **Step 4: Telas** — `equipe/novo`: nome, e-mail (obrigatório) e papel (Profissional — com o termo da conta — ou Gerente); some o formulário antigo de ficha sem e-mail. Lista da equipe: coluna de situação por `ACCESS_STATUS_LABEL`. Ficha, aba Acesso: com `invite_failed`, aviso "Convite não enviado" com o botão "Reenviar convite"; reenviar, desativar e redefinir senha continuam. Fichas antigas sem acesso continuam com o `ConviteForm` da aba Acesso.
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Verificação padrão (com `npm run smoke`) e commit** (`feat: cadastro de profissional num passo, com convite e situação do envio`)

## Parte A — Link do cliente

### Task 9: `APP_WEB_URL` e "Link para clientes" com QR code

**Files:**
- Create: `src/server/customer-link.ts`, `src/server/domain/settings/customer-link.ts`, `src/app/painel/(app)/_lib/LinkParaClientes.tsx`, `tests/unit/customer-link.test.ts`, `tests/integration/customer-link.test.ts`
- Modify: `package.json` (`qrcode`, `@types/qrcode`), `src/server/env.ts`, `src/app/painel/(app)/clientes/page.tsx`, `src/app/painel/(app)/page.tsx` (Início), `src/app/dev/(app)/contas/[id]/layout.tsx` e `src/app/dev/(app)/contas/nova/{Wizard.tsx,actions.ts,fields.ts}` (link para clientes no lugar do antigo link de entrada), `src/server/domain/platform/businesses.ts` (`BusinessDetail.customerLinkUrl`), `.env.example`, `docs/PUBLICACAO.md`
- Test: `tests/unit/customer-link.test.ts`, `tests/integration/customer-link.test.ts`, teste de env

**Interfaces:**
- Produces:
  - `env.APP_WEB_URL: string` — padrão `https://app.agendaflui.com.br`; só esquema e host (sem caminho, consulta nem barra final); em produção, `https` e não local.
  - `customerLinkUrl(slug: string, base?: string): string` → `${base}/${slug}`.
  - `customerLinkQrSvg(url: string): Promise<string>` — `qrcode` `toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })`, preto no branco.
  - `type CustomerLink = { url: string; qrSvg: string }`; `getCustomerLink(ctx: TenantContext): Promise<CustomerLink | null>` — `null` para quem não tem `manage_clients` (só dono e gerente veem).
  - Contrato que o app usa (sem mudança nesta tarefa, para referência): `GET /v1/business` com `X-Business: <slug>`, sem login → `{ id, slug, name, timeZone, brand: { logoUrl, symbolUrl, primary, accent, material, tokens: { '--brand', '--brand-strong', '--brand-tint', '--on-brand', '--brand-text', … } }, terms, modules: { loyalty, banners, store }, rules }`.

- [ ] **Step 1: Write the failing tests**

```ts
test('link para clientes junta APP_WEB_URL e o slug', () =>
  expect(customerLinkUrl('patas', 'https://app.agendaflui.com.br')).toBe('https://app.agendaflui.com.br/patas'))
test('QR é um SVG que codifica o link', ...)                                 // começa com '<svg', tem <path
test('APP_WEB_URL com caminho, http em produção ou localhost em produção não sobe', ...)
test('dono e gerente recebem o link; profissional recebe null', ...)        // integração, getCustomerLink
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implementar** — `npm install qrcode@^1.5.4 && npm install -D @types/qrcode`. `LinkParaClientes` (componente cliente): título "Link para clientes", o link em campo só leitura, `CopyButton` "Copiar link", botão "Compartilhar" só quando `navigator.share` existe, o QR (`dangerouslySetInnerHTML` do SVG gerado no servidor) e o link "Baixar QR code" (`download="link-clientes-<slug>.svg"`, `href` em `data:image/svg+xml`). Frase curta: "Ponha na bio ou mande ao cliente. Quem entra por aqui fica sempre na sua loja." Aparece no topo de Clientes e no Início, só quando `getCustomerLink` não é `null`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Verificação padrão (com `npm run smoke`) e commit** (`feat: link e QR code para clientes no painel`)

## Parte C — Equipe no app (lado da API)

### Task 10: Login da equipe sem escolher loja

Revisão: Opus

**Files:**
- Modify: `src/server/api/define-route.ts` (rota `auth: 'none'` com `limit` passa a conferir o limite geral e o da rota por IP), `src/server/auth/staff-app-auth.ts` (`loginStaff`), `src/server/auth/login-limit.ts` (área `'app-equipe'`), `src/server/api/auth-schemas.ts` (`staffLoginBusinessSchema`), `src/app/api/v1/auth/staff/login/route.ts`
- Test: `tests/integration/api/staff-auth.test.ts`, `tests/integration/api/define-route.test.ts`, `tests/integration/api/openapi.test.ts` (se conferir segurança da rota)

**Interfaces:**
- Consumes: Task 5 (no máximo um vínculo ativo por usuário).
- Produces (contrato do app):
  - `POST /v1/auth/staff/login`, **sem** `X-Business` (se vier, é ignorado), corpo `{ email: string, password: string }` → 200 `{ tokens: { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt }, member: { userId, membershipId, name, role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', professionalId: string | null }, business: { id: string, slug: string, name: string } }`. Erros: 401 `invalid_credentials` (e-mail inexistente, senha errada, sem senha, sem vínculo ativo); 503 `business_unavailable` (vínculo ativo em conta suspensa ou arquivada, só com a senha certa); 429 com `Retry-After`.
  - Todas as outras rotas da equipe seguem iguais e exigem `X-Business: <business.slug do login>`: `POST /v1/auth/staff/refresh` `{ refreshToken }` → `{ tokens }`; `POST /v1/auth/staff/logout` `{ refreshToken }` → 204; `/v1/staff/*` com `Authorization: Bearer <accessToken>`.
  - `loginStaff(input: { email: string; password: string }, meta: RequestMeta, now: Date): Promise<{ pair: TokenPair; member: StaffMember; business: { id: string; slug: string; name: string } }>`; área de limite `'app-equipe'` (sem conta).

- [ ] **Step 1: Write the failing tests** (em `staff-auth.test.ts`, reescrevendo os casos de login)

```ts
test('entra sem X-Business e recebe tokens, membro e a loja do vínculo', ...)
  // business.slug = slug da conta; o token vale em /v1/staff/me com X-Business desse slug
test('X-Business de outra loja é ignorado: entra na loja do próprio vínculo', ...)
test('senha errada, e-mail inexistente, sem vínculo ativo, sem senha: a mesma 401', ...)
test('vínculo ativo em conta suspensa: 503 business_unavailable só com a senha certa', ...)
test('a 6ª tentativa do mesmo e-mail e IP é barrada com 429', ...)
// define-route.test.ts
test("rota auth 'none' com limit devolve 429 depois do teto por IP", ...)
```

- [ ] **Step 2: Run** `npx vitest run tests/integration/api/staff-auth.test.ts tests/integration/api/define-route.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implementar** — a rota vira `auth: 'none'`, `limit: LIMITS.authIp`, `business` vem do vínculo único (`findFirst({ where: { userId, active: true } })`, sempre consultado mesmo sem usuário, como hoje, para igualar o tempo). A emissão dos tokens continua sob `$lockKey('membership', id)` com o hash relido. `last_login_at` e limpeza do limite como hoje.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Verificação padrão e commit** (`feat: login da equipe no app descobre a loja pelo vínculo`)

### Task 11: Avisos de toda a loja para dono e gerente

**Files:**
- Create: `prisma/migrations/20261123060000_avisos_da_loja/migration.sql`, `src/server/domain/team/staff-preferences.ts`
- Modify: `prisma/schema.prisma` (`Membership.notifyAllAppointments Boolean @default(false) @map("notify_all_appointments")`), `src/server/auth/staff-app-auth.ts` (`StaffProfile`), `src/app/api/v1/staff/me/route.ts` (GET e PATCH), `src/server/domain/notifications/outbox.ts`, `src/server/notifications/load.ts`, `src/server/notifications/rules.ts`
- Test: `tests/integration/api/staff-auth.test.ts` (ou `staff-routes.test.ts`), `tests/integration/outbox.test.ts`, `tests/integration/notifications/rules.test.ts`

**Interfaces:**
- Consumes: Task 10.
- Produces (contrato do app):
  - `GET /v1/staff/me` → `{ userId, membershipId, name, email, role, roleLabel, professionalId, capabilities: Capability[], notifyAllAppointments: boolean }`.
  - `PATCH /v1/staff/me` corpo `{ notifyAllAppointments: boolean }` → a mesma resposta do GET. Sem `view_all_agendas` (profissional) → 403 `forbidden`.
  - Push que o app recebe (já existe): `data: { kind: 'STAFF_NEW_APPOINTMENT' | 'STAFF_APPOINTMENT_CANCELED' | 'STAFF_APPOINTMENT_RESCHEDULED' | …, appointmentId: string }`.
  - `setNotifyAllAppointments(ctx: TenantContext, value: boolean): Promise<void>` (exige `view_all_agendas`; grava no próprio vínculo por `ctx.db`).
  - Linhas de "observador": só canal PUSH, `payload.audience = 'watcher'`, `dedupeKey` com o sufixo `:w:<membershipId>`. `LoadedPayload.audience: string | null`; `LoadedRecipient.watchesAll: boolean` (vínculo ativo, papel OWNER ou MANAGER e `notifyAllAppointments`).

- [ ] **Step 1: Write the failing tests**

```ts
test('PATCH staff/me liga a preferência do dono; GET devolve notifyAllAppointments true', ...)
test('profissional tentando ligar: 403', ...)
test('agendamento do cliente: o profissional recebe e o gerente observador recebe só por push', ...)
test('dono que é o próprio profissional do atendimento recebe um aviso só', ...)
test('cancelamento e remarcação pelo cliente também avisam o observador', ...)
test('observador rebaixado a profissional ou desativado depois de enfileirar: skip', ...)   // rules.decide
test('preferência desligada (padrão): só o profissional recebe', ...)
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implementar** — migração `ALTER TABLE "memberships" ADD COLUMN "notify_all_appointments" BOOLEAN NOT NULL DEFAULT false;`. Em `enqueueAppointmentEvent`, nos eventos do lado do cliente (`booked`, `canceled`, `rescheduled`), acrescentar as linhas de observador para os vínculos ativos OWNER/MANAGER com a preferência ligada, menos o vínculo do profissional do atendimento. Em `rules.stillValid`, linha de observador vale se `recipient.watchesAll` e: novo → agendamento ativo; remarcado → ativo e mesmo início; cancelado → cancelado.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Verificação padrão e commit** (`feat: dono e gerente podem receber os avisos de toda a loja no app`)

## Parte G — Demo

### Task 12: Demo com marca própria

**Files:**
- Create: `scripts/demo-marca/logo.svg`, `scripts/demo-marca/simbolo.svg`, `scripts/demo-brand.ts`, `tests/unit/demo-brand.test.ts`
- Modify: `scripts/demo-create.ts`, `scripts/demo-data.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 6 e 9 (`customerLinkUrl`).
- Produces: `DEMO_MARCA = { nome: 'Focinho Feliz Pet Shop', primaria: '#B4432F', destaque: '#F4C84A' }` e `renderDemoBrandImages(): Promise<{ logo: Uint8Array; symbol: Uint8Array; favicon: Uint8Array }>` em `scripts/demo-brand.ts` (sharp a partir dos SVGs; tamanhos dentro dos limites de `src/server/storage/images.ts`; favicon quadrado).

- [ ] **Step 1: Write the failing test**

```ts
test('os SVGs não usam <text> (o nome está em curvas: não depende de fonte do servidor)', ...)
test('a paleta da demo não é a da Agenda Flui nem a antiga da demo', ...)
  // primaria ∉ ['#0B6E66', '#2F7D5B'], destaque ∉ ['#F2A93B', '#F29A4B']
test('renderiza logo, símbolo e favicon como PNG nos tamanhos aceitos pelo upload', ...)
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/demo-brand.test.ts` — Expected: FAIL.
- [ ] **Step 3: Desenhar e ligar** — o logo é símbolo (um focinho/pata estilizado, traço simples) + o nome em curvas (converta o texto em caminhos uma vez, fora do repositório, por exemplo com `opentype.js` via `npx` e as fontes OFL de `../branding/AgendaFlui-Marca/fontes`; nada disso vira dependência). `criarDemo` aplica, a cada execução (idempotente): nome de exibição, cores, logo, símbolo e favicon (`replaceBrandImage`), termos "Clientes"; o resto continua só na criação. A saída impressa mostra o link para clientes (`customerLinkUrl`) e a entrada do painel (`…/entrar`); a senha continua aparecendo só no terminal de quem roda.
- [ ] **Step 4: Run** o teste e, com banco local, `npm run demo:create` duas vezes — Expected: PASS; a segunda execução diz que a conta já existia e não troca a senha.
- [ ] **Step 5: Verificação padrão e commit** (`feat: demo com nome, logo e paleta próprios`)

## Parte F — Fluidez e responsividade

### Task 13: Movimento do painel (transições de página, toque, folhas e listas)

**Files:**
- Create: `src/ui/styles/motion.css`, `tests/unit/motion-css.test.ts`
- Modify: `src/ui/ui.css` (importa `motion.css`), `src/ui/shells/*` (`PainelShell` e a moldura do painel dev: conteúdo principal dentro de `<ViewTransition>`; barra lateral com `viewTransitionName` fixo e sem animação), `src/ui/components/{Dialog.tsx,Sheet.tsx,ConfirmDialog.tsx}` e estilos (entrada e saída), `src/ui/styles/{controls,data,surfaces,feedback}.css` (resposta ao toque e entrada única de listas)

**Interfaces:**
- Produces: variáveis `--af-dur-fast: 150ms`, `--af-dur: 200ms`, `--af-dur-slow: 250ms`, `--af-ease: cubic-bezier(0.2, 0.8, 0.2, 1)`; classe de transição de página `af-page` (`<ViewTransition default="af-page">` em volta do conteúdo principal; `::view-transition-old(.af-page)`/`new` com opacidade e `translateY` de até 8px); `::view-transition { pointer-events: none; }`; classe `af-enter` para listas (anima só ao montar).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/motion-css.test.ts — lê src/ui/ui.css e src/ui/styles/*.css
test('todo @keyframes anima só transform e opacity', ...)
test('toda declaração animation, e toda transition que mexe em transform, fica sob prefers-reduced-motion: no-preference ou é anulada em reduce', ...)
test('motion.css anula a duração das view transitions em reduce', ...)
test('nenhuma duração de movimento passa de 250ms (exceto af-spin e af-pulse, indicadores contínuos)', ...)
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/motion-css.test.ts` — Expected: FAIL (as regras novas ainda não existem).
- [ ] **Step 3: Implementar** — botões, linhas clicáveis e cartões-link: `:active { transform: scale(0.98) }`; diálogo e folha com entrada e saída (`@starting-style` + `transition-behavior: allow-discrete`, ou atributo de estado; nada de `display` animado em JS); listas com `af-enter` só no primeiro render (não a cada clique). Leia `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` antes de mexer no `<ViewTransition>`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Verificação padrão (com `npm run smoke`) e commit** (`feat: transições de página e resposta ao toque no painel`)

### Task 14: Esqueletos de carregamento

**Files:**
- Create: `src/ui/components/ShellSkeleton.tsx`, `tests/unit/loading-pages.test.tsx`, e `loading.tsx` em: `src/app/painel/(app)/` (Início) e `(app)/{agenda,clientes,clientes/[id],equipe,equipe/[id],servicos,relatorios,fidelidade,banners,loja,configuracoes}/`; `src/app/dev/(app)/` e `(app)/{contas,contas/[id],auditoria,sistema,admins}/`
- Modify: `src/ui/components/index.ts`, `src/app/painel/(app)/layout.tsx` (envolve `children` num escopo com as variáveis do tema da conta, para o esqueleto já sair nas cores dela), `src/app/dev/(app)/layout.tsx` (idem, tema do painel dev)

**Interfaces:**
- Produces: `ShellSkeleton({ variant }: { variant: 'dashboard' | 'list' | 'detail' | 'planner' }): JSX.Element` — mesma grade da moldura (barra lateral com `var(--side-bg)` e área principal com `Skeleton`), `role="status"`, `aria-busy="true"`, `aria-label="Carregando"`.

- [ ] **Step 1: Write the failing test**

```ts
test.each(ROTAS_COM_DADOS)('%s tem loading.tsx com ShellSkeleton', ...)   // lê o arquivo e importa o default
test('ShellSkeleton anuncia carregamento', ...)                             // getByRole('status', { name: 'Carregando' })
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implementar** os `loading.tsx` (cada um escolhe a variante da sua tela) e o escopo de tema nos layouts.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Verificação padrão (com `npm run smoke`) e commit** (`feat: esqueletos de carregamento nas telas com dados`)

### Task 15: Responsividade do painel do negócio

**Files:**
- Create: `tests/unit/responsive.test.ts`
- Modify: telas de `src/app/painel/(app)/**` e estilos em `src/ui/styles/*.css` que o teste e a revisão apontarem; em especial `loja/pedidos/[id]/page.tsx` e `configuracoes/Formularios.tsx` (tabelas soltas viram `DataList`)

**Interfaces:**
- Produces: nenhuma tabela `<table>` fora de `src/ui/components/DataList.tsx`; formulários do painel em uma coluna abaixo de 40rem.

- [ ] **Step 1: Write the failing test**

```ts
test('nenhum <table> solto nas telas: listas usam DataList', ...)
  // arquivosCom(/<table/, ['src/app']) → [] (DataList fica em src/ui)
test('nenhuma largura fixa acima de 22.5rem/360px fora de @media ou de min()/max-width', ...)
  // varre src/ui/styles/*.css e src/ui/ui.css; exceções numa lista ALLOWED com o motivo ao lado
```

- [ ] **Step 2: Run** — Expected: FAIL nas tabelas de pedido e configurações (e no que a varredura achar).
- [ ] **Step 3: Revisar** cada tela do painel do negócio pensando em 375, 768 e 1280 px, lendo o código: nada de largura fixa; grades com `auto-fit`/`minmax`; ações de topo que quebram linha; formulários em uma coluna no celular; agenda (planner) com rolagem horizontal só dentro da grade. Sem abrir navegador.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Verificação padrão (com `npm run smoke`) e commit** (`fix: telas do painel do negócio se ajustam ao celular`)

### Task 16: Responsividade do painel dev

**Files:**
- Modify: telas de `src/app/dev/(app)/**` (em especial `contas/[id]/FormsConta.tsx`, que tem `<table>`), `src/app/dev/(app)/QuietTable.tsx` se não se ajustar, estilos do painel dev; `tests/unit/responsive.test.ts` passa a varrer também `src/app/dev`
- Test: `tests/unit/responsive.test.ts`

**Interfaces:**
- Consumes: Task 15 (o teste e a lista `ALLOWED`).

- [ ] **Step 1: Ampliar o teste** para `src/app/dev` — Run: `npx vitest run tests/unit/responsive.test.ts` — Expected: FAIL em `FormsConta.tsx`.
- [ ] **Step 2: Revisar** as telas do painel dev (lista de contas, conta e abas, assistente, auditoria, sistema, admins, perfil) com as mesmas regras da Task 15.
- [ ] **Step 3: Run** — Expected: PASS.
- [ ] **Step 4: Verificação padrão (com `npm run smoke`) e commit** (`fix: telas do painel dev se ajustam ao celular`)
