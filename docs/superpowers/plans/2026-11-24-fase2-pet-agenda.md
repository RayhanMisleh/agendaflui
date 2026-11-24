# Fase 2 — Pet e agenda — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A conta ganha o nicho pet shop (registro de nichos, pets do cliente, preço e tempo por animal e porte) e a agenda separa as regras: o cliente segue todas, a equipe marca em qualquer minuto e com qualquer duração, confirma conflitos e faz encaixe.

**Architecture:** O que é do nicho mora num registro em código (`src/server/niches/`) e em tabelas próprias (`pets`, `service_prices`); o domínio lê o nicho por `getNicheSettings` e nunca espalha `if (pet)`. A agenda da equipe deixa de recusar conflito: devolve um erro estruturado `needs_confirmation` com a lista do que há no horário e uma impressão (`acknowledgement`); repetir o pedido com a impressão grava. O encaixe é uma coluna (`is_squeeze_in`) calculada sob a trava do profissional; a restrição `appointments_no_overlap` passa a valer só entre normais, e quando um normal sai de um intervalo os encaixes dele são reavaliados na mesma transação.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19, TypeScript estrito, Prisma 7 (adapter-pg), PostgreSQL (`btree_gist`), zod 4 (via `@/server/domain/errors`), Vitest com Postgres embutido, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-23-app-unico-pet-design.md` (seções "Nicho pet shop", "Agenda: regras só para o cliente, encaixe e duração livre", "Painel dev" e "Qualidade, visual e movimento"). Regras: `AGENTS.md`. Travas: `docs/ARQUITETURA.md` (seção "Travas").

**Pré-requisito — fase 1 já mesclada.** Este plano supõe a fase 1 aplicada: endereço único com o painel em `src/app/app/painel/**` (URL `/painel/**`, mesmos nomes de arquivo de antes dentro da pasta), área do cliente em `src/app/app/[slug]/**` só com marcador, pessoa única (`Customer.userId`), API v1, tokens de renovação, dispositivos/push e termos configuráveis REMOVIDOS (rótulos fixos Profissional/Cliente/Pontos/Clube). Todo caminho de painel abaixo está no formato pós-fase 1 (`src/app/app/painel/...`); se um arquivo tiver outro nome, o executor localiza o equivalente movido (`git log --follow`, `rg`) e segue. Arquivos de domínio (`src/server/**`) mantêm o caminho. Nada aqui mexe em rotas de API, termos ou OpenAPI. Se `Business.segment` ainda existir, a Tarefa 1 o remove; se o passo "Termos" do assistente do dev ainda existir, a Tarefa 10 o troca pelo passo "Nicho".

## Global Constraints

- Regra de negócio só em `src/server/`. Dados de conta só por `tenantDb`; o cliente Prisma cru (`@/server/db/client`) fica restrito às pastas liberadas no ESLint.
- Código de domínio (`src/server/domain/**`) recebe `ctx` e usa `ctx.db` e `ctx.clock()`; nunca o cliente Prisma cru nem `new Date()`.
- Esquemas de validação importam `z` de `@/server/domain/errors`, nunca de `zod`.
- Data e hora só por `src/server/time/`.
- Travas de concorrência só pela função única `$lockKey` (`lockKeyRaw` no domínio de plataforma), na ordem descrita em `docs/ARQUITETURA.md`.
- Sem `any` e sem `@ts-ignore`.
- Tabela nova: classifique o modelo em `src/server/db/models.ts`. Se for de conta, ela tem coluna `business_id` e FK composta com `business_id` para as outras tabelas de conta; o teste estrutural (`tests/integration/schema.test.ts`) confere.
- Módulo opcional: toda função de domínio chama `requireModule` (`module_disabled`). O nicho NÃO é módulo: funções do nicho pet chamam `requirePetNiche` (Tarefa 3).
- Migrações em SQL com transação (`BEGIN;` … `COMMIT;`), escritas à mão, comentários em português, pasta nova `prisma/migrations/<AAAAMMDDhhmmss>_<nome>/`; nunca editar migração antiga. Índice parcial, CHECK, FK composta e exclusão GiST vivem só no SQL (com comentário no `schema.prisma`). Produção tem só a conta `demo`.
- Textos de interface em pt-BR, voz da marca: curta, verbo na frente, "você". Rótulos fixos "Profissional/Profissionais", "Cliente/Clientes", "Pontos", "Clube". Proibido em tela: "Tutor", "Tosador", "Patinhas", termo de outro ramo, rastro de "API do app".
- Portes (rótulo e faixa): Pequeno até 10 kg; Médio 10 a 25 kg; Grande 25 a 45 kg; Gigante acima de 45 kg. Gato tem uma variante só. `servesCats` padrão: desligado.
- Duração livre da equipe: de 5 a 720 minutos, em minutos inteiros, na marcação, no ajuste e na remarcação.
- Textos de conflito da spec, literais: "14:00–15:00 já tem Rex (Banho)", "Fora do expediente de Ana", "Loja fechada neste dia".
- Cliente nunca vê encaixe nem dado interno; para a disponibilidade, encaixes ocupam o horário como qualquer agendamento.
- Visual: marca Agenda Flui (tokens de `src/ui/styles/tokens.css`: Água `--brand`, Caramelo `--accent`, Tinta, Bolha, Espuma), kit `af-*` de `src/ui/components`, ícones `lucide-react`. Movimento só `transform`/`opacity`, tokens `--af-dur-fast|--af-dur|--af-dur-slow` e `--af-ease`, tudo sob `prefers-reduced-motion: no-preference`. Toda tela com carregamento (`loading.tsx`/esqueleto), estado vazio que convida à ação, erro que diz o que fazer, foco visível e funcionando a partir de 360 px.
- Sem testes de navegador: não rode nem escreva Playwright/e2e (`tests/e2e/**` fica como está).
- Verificação: grupos A–D rodam `npm run typecheck` e os testes tocados (`npx vitest run <arquivos>`); o grupo E roda `npm run typecheck && npm run lint && npm test && npm run build`.
- Commits locais em português no formato `tipo: descrição`, terminando com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push. Não commitar o bloco gerado pelo `next dev` no `AGENTS.md`.
- Documentação enxuta: só as linhas que ficaram erradas em `docs/ARQUITETURA.md` e `docs/superpowers/pendencias-proximas-fases.md`; sem histórico, sem doc novo.

## Review Focus

1. **Promoção em cadeia:** normal N (10:00–11:30) sai (cancelado); encaixes A (10:00–11:00) e B (10:30–11:30) se sobrepunham a ele → A volta a normal, B continua encaixe (sobrepõe A, já promovido), tudo na mesma transação. Teste na Tarefa 9 (`promove em ordem de início contando os já promovidos`).
2. **Corrida de dois normais:** dois pedidos da equipe, ao mesmo tempo, no mesmo horário livre do mesmo profissional e sem confirmação → exatamente um grava normal e o outro recebe `needs_confirmation`; inserir dois normais sobrepostos direto no banco falha com `23P01`, normal + encaixe passa. Testes na Tarefa 9.
3. **Desfazer falta sobre horário que virou de outro:** N marcado como falta, encaixe S promovido; desfazer N pede confirmação e, confirmado, N vira encaixe; desfazer "concluído" nunca pede. Teste na Tarefa 9.
4. **Gato com `servesCats` desligado:** cliente é recusado ("A loja não atende gatos no momento.") em serviço `SINGLE` e em `BY_VARIANT` com linha de gato; a equipe passa nos dois; `BY_VARIANT` sem linha de gato recusa também a equipe. Testes na Tarefa 5 (função pura) e na Tarefa 7 (marcação).
5. **Confirmação vencida:** a pessoa vê "14:00–15:00 já tem Rex (Banho)", outro membro marca algo no mesmo horário antes do "Marcar mesmo assim" → o servidor pede confirmação de novo com a lista nova, nada é gravado; mudar o horário ou o profissional também invalida a impressão. Teste na Tarefa 8.

## Decisões deste plano (o que a spec deixou aberto)

- `Business.niche` é anulável: `null` = conta sem nicho (agenda genérica, sem pet; só testes e dados antigos). `createBusiness` exige `niche: 'PET'`; a migração marca as contas existentes como `PET`.
- Opções do nicho em `business_settings.niche_options` (JSON validado pelo esquema do nicho no registro): as opções variam por nicho e o registro é dono delas; coluna tipada poria coluna de um nicho na tabela de todos.
- `appointments.pet_id` anulável no banco, sem pets de mentira: a regra "todo agendamento de conta pet tem pet" é do domínio para marcações novas; os agendamentos antigos da `demo` ficam sem pet até a fase 4 recriar a demo. A FK `(business_id, customer_id, pet_id) → pets(business_id, customer_id, id)` garante no banco que o pet é do cliente do agendamento.
- `PriceVariant` é enum do Prisma (tipo seguro); um nicho novo acrescenta valores na migração dele.
- Item de agendamento em conta pet guarda a variante do pet do momento também em serviço `SINGLE` (registro do porte atendido); preço e tempo vêm da linha da variante só em `BY_VARIANT`.
- `BY_VARIANT` grava em `services.price_cents`/`duration_min` o menor preço e a menor duração entre as linhas (resumo "a partir de" e leitores antigos); a marcação sempre lê a linha.
- Trocar o serviço para "Preço único" apaga as linhas de variante (a tela avisa). Linha de variante escondida (gato com `servesCats` desligado) é preservada em toda gravação; "ao menos uma linha" conta só as visíveis enviadas.
- A equipe pode cadastrar e agendar gato mesmo com `servesCats` desligado (regra livre da equipe); a tela avisa.
- Confirmação = erro de domínio `conflict` com `reason: 'needs_confirmation'` (cabe no encanamento atual `tenantAction`/`formError` e aborta a transação); a impressão cobre profissional, início, fim e as chaves dos conflitos.
- Ao remarcar/ajustar, a marca do próprio agendamento é recalculada antes da reavaliação dos encaixes do intervalo antigo (quem se move não toma o lugar de um encaixe).
- Com "Qualquer um" e todos os profissionais com conflito, a confirmação mostra o profissional com menos conflitos (desempate pela regra de carga atual).
- Desfazer "concluído" nunca pede confirmação (ele nunca saiu da agenda); só desfazer "faltou" reentra.
- Visão semana é lista (não há grade de horas): sobreposição aparece como itens seguidos com a marca "Encaixe"; colunas lado a lado ficam na visão dia (já existe `layoutDay`).
- Arrastar no planner encaixa de 5 em 5 minutos (início livre da equipe).
- Anonimizar cliente também anonimiza e arquiva os pets dele (nome "Pet", sem raça, cuidados e foto).

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `prisma/migrations/20261124000000_nicho_pet/migration.sql` | enums do nicho, `businesses.niche`, `business_settings.niche_options`, tabela `pets` |
| `prisma/migrations/20261124010000_precos_por_variante/migration.sql` | `services.pricing_mode`, tabela `service_prices` |
| `prisma/migrations/20261124020000_agendamento_pet_encaixe/migration.sql` | `appointments.pet_id`, `is_squeeze_in`, `appointment_items.variant`, restrição refeita |
| `src/server/niches/{types,pet,index}.ts` | registro de nichos (puro) |
| `src/server/domain/settings/niche-settings.ts` | nicho e opções da conta; `requirePetNiche` |
| `src/server/domain/pets/{pets,photo,age}.ts` | pets: CRUD equipe/cliente, foto, idade |
| `src/server/domain/catalog/pricing.ts` | elegibilidade, preço da variante, "a partir de" (puro) |
| `src/server/domain/catalog/pet-services.ts` | serviços de um pet, com preço e tempo |
| `src/server/domain/scheduling/staff-issues.ts` | conflitos da equipe, impressão, `needs_confirmation` |
| `src/server/domain/scheduling/squeeze-in.ts` | marca de encaixe e promoção |
| `src/ui/components/{PetCard,PetTypePicker,pet-illustrations,MinutesField}.tsx`, `src/ui/styles/pets.css` | peças de tela do pet e duração livre |
| `src/app/app/painel/clientes/[id]/pets/**` | páginas, ações e rota de foto do pet |
| `src/app/app/painel/agenda/{ConflitosDialog,ConflitosAviso}.tsx` | confirmação de conflitos na agenda |

## Grupos de execução

| Grupo | Tarefas | Entrega verificável |
|---|---|---|
| A — Nicho e pets | 1, 2, 3, 4 | banco, registro, opções e domínio de pets testados |
| B — Preço por porte | 5, 6 | serviços com preço por variante e elegibilidade única |
| C — Agenda | 7, 8, 9 | marcação com pet, confirmação, duração livre, encaixe e promoção |
| D — Telas de cadastro | 10, 11, 12 | Configurações, assistente do dev, Clientes com pets, Serviços por porte |
| E — Telas da agenda e fecho | 13, 14, 15 | planner com encaixe, folha de marcar com pet e confirmação, verificação completa |

Cada grupo começa com o anterior commitado. Dentro do grupo, as tarefas vão em ordem.

---

## Grupo A — Nicho e pets

### Task 1: Banco do nicho e dos pets

**Files:**
- Create: `prisma/migrations/20261124000000_nicho_pet/migration.sql`
- Modify: `prisma/schema.prisma` (enums novos; `Business`, `BusinessSettings`, `Customer`, `Upload`; modelo `Pet`), `src/server/db/models.ts`, `tests/setup/factories.ts`, `tests/integration/schema.test.ts`, `scripts/demo-create.ts` e `prisma/seed.ts` (só se ainda usam `segment`)
- Test: `tests/integration/schema.test.ts`, `tests/integration/pets-schema.test.ts`

**Interfaces:**
- Produces (Prisma): enums `Niche { PET }`, `PetSpecies { DOG CAT }`, `PetSize { SMALL MEDIUM LARGE GIANT }`, `PetCoat { SHORT MEDIUM LONG }`, `PriceVariant { DOG_SMALL DOG_MEDIUM DOG_LARGE DOG_GIANT CAT }`; `Business.niche Niche?`; `BusinessSettings.nicheOptions Json @default("{}") @map("niche_options")`; modelo `Pet` (tabela `pets`): `id`, `businessId`, `customerId`, `name`, `searchName @default("")`, `species PetSpecies`, `size PetSize?`, `breed String?`, `birthMonth DateTime? @db.Date @map("birth_month")`, `coat PetCoat?`, `careNotes String? @map("care_notes")`, `photoUploadId String? @db.Uuid @map("photo_upload_id")` (relação `"PetPhoto"` com `Upload`, `onDelete: SetNull`), `archivedAt`, `createdAt`, `updatedAt`; `@@unique([businessId, id])`, `@@unique([businessId, customerId, id])`, `@@index([businessId, customerId])`, `@@index([businessId, searchName])`. Relações inversas `Business.pets`, `Customer.pets`, `Upload.petPhotos`.
- Produces (fábrica): `makePet(businessId: string, customerId: string, overrides?: Partial<Omit<Prisma.PetUncheckedCreateInput, 'businessId' | 'customerId'>>): Promise<Pet>` — padrão: nome único `Pet <sufixo>`, `species: 'DOG'`, `size: 'MEDIUM'`, `searchName` = `searchKey(nome)`.
- `makeBusiness` não muda (nicho `null` por padrão); teste que precisa de pet shop passa `{ niche: 'PET' }`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/integration/pets-schema.test.ts`, com `prisma` cru e fábricas:
```ts
test('cão sem porte é recusado pelo banco', async () => {
  const b = await makeBusiness({ niche: 'PET' }); const c = await makeCustomer(b.id)
  await expect(makePet(b.id, c.id, { species: 'DOG', size: null })).rejects.toThrow(/pets_size_by_species_check/)
})
test('gato com porte é recusado pelo banco', /* species CAT, size SMALL → pets_size_by_species_check */)
test('mês de nascimento precisa ser o dia 1', /* birthMonth 2024-03-15 → pets_birth_month_check */)
test('pet de outra conta não pode apontar para o cliente', /* business A, customer de B → pets_customer_id_same_business_fkey */)
test('opções do nicho precisam ser objeto', /* update niche_options = '[]'::jsonb via $executeRaw → business_settings_niche_options_check */)
```
Em `tests/integration/schema.test.ts`: as tabelas `pets` entram na lista de conta e `verificarFks` continua vazio (o teste existente já percorre `TENANT_MODELS`; basta o modelo estar classificado).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/integration/pets-schema.test.ts tests/integration/schema.test.ts`
Expected: FAIL (`niche`/`makePet` não existem).

- [ ] **Step 3: Migração e schema**

`migration.sql`, entre `BEGIN;` e `COMMIT;`, com comentários em português:
1. `CREATE TYPE` dos cinco enums.
2. `ALTER TABLE "businesses" ADD COLUMN "niche" "Niche";` e `UPDATE "businesses" SET "niche" = 'PET';` (comentário: produção só tem a `demo`, que é pet shop). `ALTER TABLE "businesses" DROP COLUMN IF EXISTS "segment";` (o nicho substitui o texto livre).
3. `ALTER TABLE "business_settings" ADD COLUMN "niche_options" JSONB NOT NULL DEFAULT '{}';` + `CONSTRAINT "business_settings_niche_options_check" CHECK (jsonb_typeof("niche_options") = 'object')`.
4. `CREATE TABLE "pets"` com as colunas acima (`id UUID DEFAULT gen_random_uuid()`, `Timestamptz(3)`), PK, únicos `pets_business_id_id_key`, `pets_business_id_customer_id_id_key`, índices; FKs simples do padrão Prisma (`business_id → businesses ON DELETE CASCADE`, `customer_id → customers`, `photo_upload_id → uploads ON DELETE SET NULL`) e as compostas: `pets_customer_id_same_business_fkey (business_id, customer_id) → customers(business_id, id) ON DELETE CASCADE ON UPDATE NO ACTION`; `pets_photo_upload_id_same_business_fkey (business_id, photo_upload_id) → uploads(business_id, id) ON DELETE SET NULL ("photo_upload_id") ON UPDATE NO ACTION`.
5. CHECKs: `pets_size_by_species_check CHECK (("species" = 'DOG' AND "size" IS NOT NULL) OR ("species" = 'CAT' AND "size" IS NULL))`; `pets_name_check CHECK (char_length(btrim("name")) BETWEEN 1 AND 40)`; `pets_breed_check CHECK ("breed" IS NULL OR char_length("breed") <= 60)`; `pets_care_notes_check CHECK ("care_notes" IS NULL OR char_length("care_notes") <= 1000)`; `pets_birth_month_check CHECK ("birth_month" IS NULL OR extract(day FROM "birth_month") = 1)`.

`schema.prisma`: o descrito em Interfaces; remover `segment` de `Business` se ainda existir; comentários `///` citando os CHECKs e as FKs compostas que vivem só na migração. `models.ts`: `'Pet'` em `TENANT_MODELS`. Se `scripts/demo-create.ts` ou `prisma/seed.ts` ainda gravam `segment`, troque por `niche: 'PET'` (demo) e, no seed, `niche: c.segmento === 'Pet shop' ? 'PET' : null`.

- [ ] **Step 4: Fábrica `makePet`** em `tests/setup/factories.ts` (assinatura em Interfaces).

- [ ] **Step 5: Rodar e ver passar**

Run: `npx prisma generate && npm run typecheck && npx vitest run tests/integration/pets-schema.test.ts tests/integration/schema.test.ts tests/integration/db-self-check.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit** — `feat: nicho da conta e tabela de pets no banco`

### Task 2: Registro de nichos

**Files:**
- Create: `src/server/niches/types.ts`, `src/server/niches/pet.ts`, `src/server/niches/index.ts`
- Test: `tests/unit/niches.test.ts`

**Interfaces:**
- Produces (`types.ts`, tipos dos enums vêm de `@/server/db/generated/client` só como `import type`):
```ts
export type NicheKey = Niche
export type PetOptions = { servesCats: boolean }
export type VariantDef = { key: PriceVariant; label: string; shortLabel: string; rangeLabel: string | null; species: PetSpecies; size: PetSize | null; needsOption: 'servesCats' | null }
export type QuizStepKey = 'name' | 'species' | 'size' | 'breed' | 'age' | 'coat' | 'care' | 'photo' | 'summary'
export type QuizStep = { key: QuizStepKey; title: string; optional: boolean; onlyIf: 'servesCats' | null }
export type VariantPrice = { priceCents: number; durationMin: number }
export type ServiceSuggestion = { name: string; icon: ServiceIconName; description: string; prices: Record<PriceVariant, VariantPrice> }
export type NicheDef = {
  key: NicheKey; label: string
  subject: { singular: string; plural: string; add: string; empty: string }
  variants: readonly VariantDef[]
  optionsSchema: z.ZodType<PetOptions>; defaultOptions: PetOptions
  quiz: readonly QuizStep[]; careQuickOptions: readonly string[]
  breedSuggestions: Readonly<Record<PetSpecies, readonly string[]>>
  coatLabels: Readonly<Record<PetCoat, string>>
  serviceSuggestions: readonly ServiceSuggestion[]
}
```
- Produces (`index.ts`): `NICHES: Readonly<Record<NicheKey, NicheDef>>`; `nicheDef(key: NicheKey | null): NicheDef | null`; `parseNicheOptions(key: NicheKey | null, raw: unknown): PetOptions` (inválido ou ausente → padrão, nunca lança); `variantOfPet(p: { species: PetSpecies; size: PetSize | null }): PriceVariant` (cão sem porte lança `Error` de programação); `variantDef(v: PriceVariant): VariantDef`; `visibleVariants(def: NicheDef, options: PetOptions): readonly VariantDef[]`; `isVariantVisible(v: PriceVariant, options: PetOptions): boolean`.

Valores fixos do `pet.ts`:
- `label: 'Pet shop'`; `subject: { singular: 'pet', plural: 'pets', add: 'Adicionar pet', empty: 'Nenhum pet ainda' }`; `defaultOptions: { servesCats: false }`; `optionsSchema = z.object({ servesCats: z.boolean() })`.
- Variantes, nesta ordem: `DOG_SMALL` ('Cão pequeno', 'Pequeno', 'até 10 kg'), `DOG_MEDIUM` ('Cão médio', 'Médio', '10 a 25 kg'), `DOG_LARGE` ('Cão grande', 'Grande', '25 a 45 kg'), `DOG_GIANT` ('Cão gigante', 'Gigante', 'acima de 45 kg'), `CAT` ('Gato', 'Gato', `null`, `needsOption: 'servesCats'`).
- Quiz (para a fase 3), nesta ordem: name 'Qual é o nome do seu pet?'; species 'Cão ou gato?' (`onlyIf: 'servesCats'`); size 'Qual é o porte?'; breed 'Qual é a raça?' (opcional); age 'Quantos anos, mais ou menos?' (opcional); coat 'Como é a pelagem?' (opcional); care 'Algum cuidado especial?' (opcional); photo 'Quer adicionar uma foto?' (opcional); summary 'Tudo certo?'.
- `careQuickOptions: ['Medo de secador', 'Alergia', 'Agitado', 'Idoso']`; `coatLabels: { SHORT: 'Curta', MEDIUM: 'Média', LONG: 'Longa' }`.
- `breedSuggestions.DOG`: 'Sem raça definida', 'Shih-tzu', 'Poodle', 'Yorkshire', 'Lhasa apso', 'Spitz alemão', 'Maltês', 'Pinscher', 'Bulldog francês', 'Golden retriever', 'Labrador', 'Border collie', 'Pastor alemão', 'Husky siberiano'; `CAT`: 'Sem raça definida', 'Persa', 'Siamês', 'Maine coon', 'Angorá', 'Ragdoll', 'British shorthair'.
- Sugestões de serviço (fase 4), centavos/minutos na ordem SMALL, MEDIUM, LARGE, GIANT, CAT: Banho (`bath`) 5000/60, 6500/60, 8500/90, 11000/120, 7000/60; Banho e tosa (`scissors`) 8000/90, 10000/120, 13000/150, 17000/180, 12000/120; Tosa higiênica (`brush`) 4000/30, 5000/45, 6000/45, 7500/60, 5000/45; Hidratação (`droplets`) 3500/30, 4500/30, 5500/45, 7000/45, 4500/30; Corte de unha (`paw-print`) 2000/15, 2000/15, 2500/15, 3000/20, 2500/15.

- [ ] **Step 1: Testes que falham** em `tests/unit/niches.test.ts`:
```ts
test('variantOfPet: cão médio → DOG_MEDIUM; gato → CAT', ...)
test('variantOfPet: cão sem porte lança', () => expect(() => variantOfPet({ species: 'DOG', size: null })).toThrow())
test('visibleVariants esconde gato sem servesCats e mostra com ele', () => {
  expect(visibleVariants(NICHES.PET, { servesCats: false }).map((v) => v.key)).toEqual(['DOG_SMALL', 'DOG_MEDIUM', 'DOG_LARGE', 'DOG_GIANT'])
  expect(visibleVariants(NICHES.PET, { servesCats: true }).map((v) => v.key)).toContain('CAT')
})
test('parseNicheOptions: lixo, vazio e nicho nulo viram o padrão', () => {
  expect(parseNicheOptions('PET', { servesCats: 'sim' })).toEqual({ servesCats: false })
  expect(parseNicheOptions('PET', {})).toEqual({ servesCats: false })
  expect(parseNicheOptions(null, { servesCats: true })).toEqual({ servesCats: false })
  expect(parseNicheOptions('PET', { servesCats: true })).toEqual({ servesCats: true })
})
test('faixas de porte da spec', () => expect(NICHES.PET.variants.map((v) => v.rangeLabel)).toEqual(['até 10 kg', '10 a 25 kg', '25 a 45 kg', 'acima de 45 kg', null]))
test('sugestões: durações múltiplas de 5 entre 5 e 600 e preços inteiros', ...)
test('nenhum texto do registro usa termo proibido', () => /* JSON.stringify(NICHES) não casa /tutor|tosador|patinhas/i */)
```
- [ ] **Step 2:** `npx vitest run tests/unit/niches.test.ts` → FAIL.
- [ ] **Step 3:** Implementar os três arquivos.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/unit/niches.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: registro de nichos com o pet shop`

### Task 3: Nicho e opções da conta no domínio

**Files:**
- Create: `src/server/domain/settings/niche-settings.ts`
- Modify: `src/server/domain/errors.ts` (`DOMAIN_REASONS` += `'needs_confirmation'`, `'niche_unavailable'`, `'not_offered'`), `src/server/domain/settings/versioned.ts` (`SettingsWrite.data` aceita `nicheOptions?: Prisma.InputJsonObject`, tratado como `notifications`), `src/server/domain/settings/painel-context.ts`
- Test: `tests/integration/niche-settings.test.ts`

**Interfaces:**
- Produces:
```ts
export type NicheSettings = { niche: NicheDef | null; options: PetOptions; version: number }
export async function getNicheSettings(ctx: TenantContext, db?: TenantClient | TenantTx): Promise<NicheSettings>
export async function requirePetNiche(ctx: TenantContext, db?: TenantClient | TenantTx): Promise<NicheSettings & { niche: NicheDef }>
// lança DomainError('conflict', 'Esta loja não atende pets.', { reason: 'niche_unavailable' })
export async function updateNicheOptions(ctx: TenantContext, i: { servesCats: boolean; version?: number }): Promise<NicheSettings>
// authorize manage_settings; requirePetNiche; writeSettings; audit 'settings.niche_options_updated' { servesCats }
```
- `getPainelContext` passa a devolver também `niche: { key: NicheKey; label: string; servesCats: boolean } | null`.

- [ ] **Step 1: Testes que falham**:
```ts
test('conta sem nicho: niche null e opções padrão')
test('conta pet: lê servesCats gravado; JSON inválido gravado vira padrão sem quebrar')
test('updateNicheOptions liga gatos, sobe a versão e audita settings.niche_options_updated')
test('updateNicheOptions com versão velha → conflict stale_version')
test('profissional não altera (forbidden); gerente altera')
test('conta sem nicho: updateNicheOptions → niche_unavailable')
test('getPainelContext traz { key: "PET", label: "Pet shop", servesCats } para conta pet e null sem nicho')
```
- [ ] **Step 2:** `npx vitest run tests/integration/niche-settings.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/niche-settings.test.ts tests/integration/settings-write.test.ts tests/unit/settings-write.test.ts` (os que existirem) → PASS.
- [ ] **Step 5: Commit** — `feat: opções do nicho da conta (atende gatos)`

### Task 4: Domínio dos pets

**Files:**
- Create: `src/server/domain/pets/pets.ts`, `src/server/domain/pets/photo.ts`, `src/server/domain/pets/age.ts`
- Modify: `src/server/domain/customers/customers.ts` (`anonymizeCustomer` anonimiza pets; nova `createCustomerWithPet`; busca por nome de pet em `listCustomers`)
- Test: `tests/integration/pets.test.ts`, `tests/unit/pet-age.test.ts`

**Interfaces:**
- Produces (`pets.ts`):
```ts
export type PetView = {
  id: string; customerId: string; name: string; species: PetSpecies; size: PetSize | null
  variant: PriceVariant; typeLabel: string   // "Cão médio" (variantDef(...).label)
  rangeLabel: string | null                  // "10 a 25 kg"
  breed: string | null; birthMonth: string | null /* 'AAAA-MM' */; ageLabel: string | null
  coat: PetCoat | null; careNotes: string | null; photoUrl: string | null
  archived: boolean; createdAt: Date
}
export type PetInput = { name: string; species: PetSpecies; size?: PetSize | null; breed?: string | null; birthMonth?: string | null; coat?: PetCoat | null; careNotes?: string | null }
export const MAX_ACTIVE_PETS = 20
export async function listPets(ctx: TenantContext, customerId: string, o?: { includeArchived?: boolean }): Promise<PetView[]>
export async function listMyPets(ctx: TenantContext, o?: { includeArchived?: boolean }): Promise<PetView[]>   // só ator customer
export async function listPetsByCustomers(ctx: TenantContext, customerIds: string[]): Promise<Map<string, PetView[]>> // equipe; ativos
export async function getPet(ctx: TenantContext, id: string): Promise<PetView>
export async function createPet(ctx: TenantContext, customerId: string, input: PetInput): Promise<PetView>
export async function updatePet(ctx: TenantContext, id: string, input: Partial<PetInput>): Promise<PetView>
export async function archivePet(ctx: TenantContext, id: string): Promise<void>
export async function restorePet(ctx: TenantContext, id: string): Promise<PetView>
export async function loadPetForBooking(db: TenantClient | TenantTx, i: { petId: string; customerId: string }): Promise<{ id: string; name: string; variant: PriceVariant }>
// recusa pet arquivado ou de outro cliente: DomainError('validation', 'Escolha um pet deste cliente.', { fields: { petId } })
```
- `photo.ts`: `setPetPhoto(ctx: TenantContext, petId: string, image: { bytes: Uint8Array } | null): Promise<void>` — mesmo padrão de `src/server/domain/team/avatar.ts` (`saveImage` propósito `'avatar'`, remove o arquivo antigo depois do commit).
- `age.ts`: `petAgeLabel(birthMonth: string, today: string): string | null` ('AAAA-MM' e 'AAAA-MM-DD' local) → "Menos de 1 mês", "8 meses", "1 ano", "3 anos"; mês futuro → `null`.
- `customers.ts`: `createCustomerWithPet(ctx: TenantContext, customer: CustomerInput, pet: PetInput): Promise<{ customer: CustomerView; pet: PetView }>` — uma transação; extraia a criação atual para `createCustomerIn(tx, ctx, input)` interna e reutilize.

Regras:
- Equipe: ler exige `view_clients`; escrever exige `manage_clients`. Cliente (`ctx.actor.kind === 'customer'`): só pets do próprio `customerId`; pet de outro cliente → `not_found` (nunca `forbidden`). Cliente cria, edita, arquiva e restaura os próprios.
- Toda função chama `requirePetNiche(ctx)`. Cliente arquivado/anonimizado → `validation` "Este cliente está arquivado. Restaure antes de adicionar pets." (equipe) ou `forbidden` "Seu cadastro não está ativo. Fale com a loja." (cliente).
- Validação: nome 1–40 (aparado), espécie obrigatória; cão exige porte ("Escolha o porte."); gato com porte → "Gato não tem porte." (campo `size`); raça ≤ 60, `null` se vazia; `birthMonth` `AAAA-MM`, ano ≥ 1990 e não depois do mês atual da conta ("Informe um mês que já passou."); cuidados ≤ 1000; no máximo `MAX_ACTIVE_PETS` ativos por cliente ("Este cliente já tem 20 pets ativos. Arquive algum antes.").
- Gravação em `ctx.db.$transaction` com `tx.$lockKey('customer', customerId)` primeiro (escopo sozinho, como em `docs/ARQUITETURA.md`); `searchName = searchKey(name)`; audit `pet.created|pet.updated|pet.archived|pet.restored` (metadata só ids e campos alterados, nunca o texto dos cuidados).
- `listCustomers`: `search` também casa clientes com pet ativo cujo `searchName` contém a chave (`OR` com o filtro atual).
- `anonymizeCustomer`: dentro da mesma transação, cada pet do cliente fica `name: 'Pet'`, `searchName: 'pet'`, `breed/careNotes/birthMonth: null`, `photoUploadId: null` (apague o upload como o avatar), `archivedAt` = agora se nulo.

- [ ] **Step 1: Testes que falham** (`tests/integration/pets.test.ts`, conta `makeBusiness({ niche: 'PET' })`, relógio fixo `2026-11-16T11:00:00Z`):
```ts
test('dono cria cão médio: typeLabel "Cão médio", rangeLabel "10 a 25 kg", ageLabel de 2023-05 = "3 anos"')
test('cão sem porte → validation fields.size "Escolha o porte."; gato com porte → "Gato não tem porte."')
test('mês de nascimento futuro → validation fields.birthMonth')
test('profissional lê pets (view_clients) mas não cria (forbidden)')
test('cliente cria e lista só os próprios; getPet de pet de outro cliente → not_found; updatePet alheio → not_found')
test('conta sem nicho: createPet → niche_unavailable')
test('arquivar some da lista padrão; includeArchived traz; restaurar volta')
test('21º pet ativo → validation; arquivar um libera')
test('loadPetForBooking recusa pet arquivado e pet de outro cliente')
test('listCustomers acha a dona pelo nome do pet ("thor" acha Marina, dona do Thor)')
test('createCustomerWithPet: falha no pet (cão sem porte) não deixa cliente gravado')
test('anonymizeCustomer: pets viram "Pet", sem raça e cuidados, arquivados')
test('setPetPhoto grava e troca a foto; photoUrl aparece na visão')
```
`tests/unit/pet-age.test.ts`: `petAgeLabel('2026-11','2026-11-16') === 'Menos de 1 mês'`, `('2026-03','2026-11-16') === '8 meses'`, `('2025-11','2026-11-16') === '1 ano'`, `('2023-05','2026-11-16') === '3 anos'`, `('2026-12','2026-11-16') === null`.
- [ ] **Step 2:** `npx vitest run tests/integration/pets.test.ts tests/unit/pet-age.test.ts` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/pets.test.ts tests/unit/pet-age.test.ts tests/integration/customers.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: pets do cliente no domínio (equipe e cliente)`

---

## Grupo B — Preço por animal e porte

### Task 5: Banco dos preços e elegibilidade única

**Files:**
- Create: `prisma/migrations/20261124010000_precos_por_variante/migration.sql`, `src/server/domain/catalog/pricing.ts`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `tests/setup/factories.ts`
- Test: `tests/unit/pricing.test.ts`, `tests/integration/service-prices-schema.test.ts`

**Interfaces:**
- Prisma: `enum PricingMode { SINGLE BY_VARIANT }`; `Service.pricingMode PricingMode @default(SINGLE) @map("pricing_mode")`, `Service.prices ServicePrice[]`; modelo `ServicePrice` (tabela `service_prices`): `id`, `businessId`, `serviceId`, `variant PriceVariant`, `priceCents Int @map("price_cents")`, `durationMin Int @map("duration_min")`, `createdAt`, `updatedAt`; `@@unique([businessId, id])`, `@@unique([serviceId, variant])`; relação com `Service` `onDelete: Cascade`. `'ServicePrice'` em `TENANT_MODELS`.
- SQL: tipo e coluna; tabela; FK composta `service_prices_service_id_same_business_fkey (business_id, service_id) → services(business_id, id) ON DELETE CASCADE ON UPDATE NO ACTION`; CHECKs `service_prices_price_cents_check (price_cents BETWEEN 0 AND 10000000)`, `service_prices_duration_min_check (duration_min BETWEEN 5 AND 600 AND duration_min % 5 = 0)`. Serviços existentes ficam `SINGLE` pelo padrão.
- Fábrica: `makeServicePrice(businessId: string, serviceId: string, variant: PriceVariant, o?: { priceCents?: number; durationMin?: number }): Promise<ServicePrice>` (padrão 5000 / 30) — e marca o serviço como `BY_VARIANT`.
- `pricing.ts` (puro, sem banco):
```ts
export type VariantPriceRow = { variant: PriceVariant; priceCents: number; durationMin: number }
export type PricedService = { pricingMode: PricingMode; priceCents: number; durationMin: number; prices: readonly VariantPriceRow[] }
export type Asker = 'customer' | 'staff'
export function isServiceOffered(s: Pick<PricedService, 'pricingMode' | 'prices'>, variant: PriceVariant | null, o: { who: Asker; servesCats: boolean }): boolean
export function priceFor(s: PricedService, variant: PriceVariant | null): VariantPrice | null   // SINGLE → preço único; BY_VARIANT → linha ou null
export function fromPrice(s: PricedService, o: { servesCats: boolean }): { cents: number; varies: boolean } | null
```
Regra única (spec): `variant === 'CAT' && who === 'customer' && !servesCats` → `false`; senão `SINGLE` → `true`; `BY_VARIANT` → existe linha da variante (`variant === null` → `false`). `fromPrice`: `SINGLE` → `{ cents: priceCents, varies: false }`; `BY_VARIANT` → menor preço entre as linhas visíveis ao cliente (`isVariantVisible`), `varies` = há preços diferentes; nenhuma visível → `null`.

- [ ] **Step 1: Testes que falham** em `tests/unit/pricing.test.ts` (tabela de casos):
```ts
const single = { pricingMode: 'SINGLE', priceCents: 5000, durationMin: 60, prices: [] } as const
const porPorte = { pricingMode: 'BY_VARIANT', priceCents: 5000, durationMin: 60, prices: [
  { variant: 'DOG_SMALL', priceCents: 5000, durationMin: 60 }, { variant: 'CAT', priceCents: 7000, durationMin: 60 }] } as const
test.each([
  [single, 'DOG_GIANT', 'customer', false, true],
  [single, 'CAT', 'customer', false, false],
  [single, 'CAT', 'staff', false, true],
  [single, 'CAT', 'customer', true, true],
  [porPorte, 'DOG_SMALL', 'customer', false, true],
  [porPorte, 'DOG_LARGE', 'staff', true, false],
  [porPorte, 'CAT', 'customer', false, false],
  [porPorte, 'CAT', 'staff', false, true],
  [{ ...porPorte, prices: porPorte.prices.slice(0, 1) }, 'CAT', 'staff', true, false],
  [porPorte, null, 'staff', true, false],
  [single, null, 'customer', false, true],
])('isServiceOffered %#', (s, v, who, servesCats, esperado) => expect(isServiceOffered(s, v, { who, servesCats })).toBe(esperado))
test('priceFor: SINGLE devolve o único; BY_VARIANT devolve a linha ou null')
test('fromPrice: gato escondido não entra no "a partir de"; só linha de gato e gatos desligados → null; preços iguais → varies false')
```
`tests/integration/service-prices-schema.test.ts`: linha duplicada para a mesma variante → `service_prices_service_id_variant_key`; duração 7 → CHECK; serviço de outra conta → FK composta.
- [ ] **Step 2:** rodar os dois → FAIL.
- [ ] **Step 3:** migração, schema, models, fábrica, `pricing.ts`.
- [ ] **Step 4:** `npx prisma generate && npm run typecheck && npx vitest run tests/unit/pricing.test.ts tests/integration/service-prices-schema.test.ts tests/integration/schema.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: preço por variante no banco e regra única de elegibilidade`

### Task 6: Serviços com preço por porte no domínio

**Files:**
- Create: `src/server/domain/catalog/pet-services.ts`
- Modify: `src/server/domain/catalog/services.ts`, `src/server/domain/scheduling/availability.ts` (`resolveServices`)
- Test: `tests/integration/services-pricing.test.ts`, `tests/integration/services.test.ts` (continua verde)

**Interfaces:**
- `ServiceView` ganha `pricingMode: PricingMode` e `prices: VariantPriceRow[]` (na ordem do registro; para o ator cliente, só as variantes visíveis por `isVariantVisible`).
- `ServiceInput` ganha `pricingMode?: PricingMode` e `variantPrices?: VariantPriceRow[]`. Com `BY_VARIANT`, `priceCents`/`durationMin` ficam opcionais e são ignorados: as colunas guardam o menor preço e a menor duração entre TODAS as linhas gravadas (inclusive escondidas).
- `resolveServices(ctx, serviceIds, db = ctx.db, pricing: { variant: PriceVariant | null } = { variant: null }): Promise<{ items: ResolvedItem[]; durationMin: number; totalCents: number }>` com `export type ResolvedItem = ServiceView & { variant: PriceVariant | null }` (preço e duração já os da variante).
- `pet-services.ts`:
```ts
export type PetServiceOption = { service: ServiceView; offered: boolean; priceCents: number | null; durationMin: number | null; reason: string | null }
export async function listServicesForPet(ctx: TenantContext, petId: string): Promise<PetServiceOption[]>
```
Equipe (qualquer `view_own_agenda`) recebe todos os ativos com `offered` e `reason` ("Não atende Cão gigante", "A loja não atende gatos no momento"); cliente recebe só os oferecidos, só do próprio pet (alheio → `not_found`).

Regras de gravação (`createService`/`updateService`):
- `BY_VARIANT` só em conta com nicho (`requirePetNiche`); sem nicho → `validation` `fields.pricingMode` "Preço por porte só existe em conta pet shop.".
- `variantPrices`: variantes do nicho, sem repetir; cada linha com os mesmos limites de `priceCents`/`durationMin` do serviço e `onGrid` quando pedido. Pelo menos uma linha enviada ("Preencha o preço de pelo menos um porte.", `fields.variantPrices`).
- Substituição só das variantes visíveis: com `servesCats` desligado, a linha `CAT` existente é mantida intacta (nem apagada nem alterada) mesmo ausente do pedido; com gatos ligados, ausência = apagar.
- Trocar para `SINGLE` apaga todas as linhas e exige `priceCents`/`durationMin`.
- Tudo na transação com `tx.$lockKey('catalog', ctx.businessId)` (escopo sozinho, como hoje); audit `service.updated` com `fields` incluindo `pricingMode`/`variantPrices`.

`resolveServices` com `variant`: para cada serviço, `isServiceOffered(row, variant, { who: isCustomer(ctx) ? 'customer' : 'staff', servesCats })`; lê `servesCats` só quando `variant === 'CAT'`. Recusas:
- cliente, gato, gatos desligados → `DomainError('conflict', 'A loja não atende gatos no momento.', { reason: 'not_offered' })`;
- `BY_VARIANT` sem variante → `validation` `fields.serviceIds` `Escolha o pet para ver o preço de ${nome}.`;
- sem linha → `validation` `fields.serviceIds`, `reason: 'not_offered'`, `${nome} não é feito para ${typeLabel}.` (ex.: "Tosa não é feito para Cão gigante.").
A soma de duração continua limitada a 720.

- [ ] **Step 1: Testes que falham** (`tests/integration/services-pricing.test.ts`, conta pet, `slotStepMin` 15):
```ts
test('cria BY_VARIANT com pequeno e médio: colunas guardam o menor preço e a menor duração')
test('BY_VARIANT sem linhas → validation fields.variantPrices')
test('BY_VARIANT em conta sem nicho → validation fields.pricingMode')
test('gatos desligados: salvar só as linhas de cão mantém a linha de gato gravada; religar gatos mostra a linha na visão do cliente')
test('gatos ligados: omitir a linha de gato a apaga')
test('trocar para SINGLE apaga as linhas')
test('visão do cliente esconde a linha de gato com gatos desligados; equipe vê todas')
test('resolveServices com DOG_LARGE usa preço e tempo da linha e soma o total')
test('resolveServices: BY_VARIANT sem linha da variante → not_offered com "Tosa não é feito para Cão grande."')
test('resolveServices cliente com gato e gatos desligados → "A loja não atende gatos no momento." (serviço SINGLE)')
test('resolveServices equipe com gato e gatos desligados: SINGLE passa; BY_VARIANT com linha de gato passa')
test('listServicesForPet: equipe vê não oferecido com reason; cliente só oferecidos e só do próprio pet')
```
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/services-pricing.test.ts tests/integration/services.test.ts tests/integration/availability.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: serviços com preço e tempo por animal e porte`

---

## Grupo C — Agenda

### Task 7: Agendamento com pet e foto do preço

**Files:**
- Create: `prisma/migrations/20261124020000_agendamento_pet_encaixe/migration.sql`
- Modify: `prisma/schema.prisma`, `src/server/domain/scheduling/appointments.ts`, `src/server/domain/scheduling/appointment-view.ts`, `src/server/domain/scheduling/availability.ts` (`getAvailability`, `listAvailableDays`), `tests/setup/factories.ts` (`makeAppointment` aceita `petId?`, `isSqueezeIn?`), `scripts/demo-create.ts`, `prisma/seed.ts`
- Test: `tests/integration/appointments-pet.test.ts`

**Interfaces:**
- Prisma: `Appointment.petId String? @db.Uuid @map("pet_id")` (relação `pet Pet? onDelete: Restrict`), `Appointment.isSqueezeIn Boolean @default(false) @map("is_squeeze_in")`, `@@index([businessId, petId, startsAt])`; `AppointmentItem.variant PriceVariant?`; `Pet.appointments Appointment[]`.
- SQL (uma transação): colunas; FK simples `appointments_pet_id_fkey → pets(id) ON DELETE RESTRICT`; FK composta `appointments_pet_id_same_customer_fkey (business_id, customer_id, pet_id) → pets(business_id, customer_id, id) ON DELETE RESTRICT ON UPDATE NO ACTION` (comentário: o pet é do cliente do agendamento; `MATCH SIMPLE` deixa `pet_id` nulo passar); `appointments_duration_max_check CHECK (total_duration_min <= 720)`; `ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";` e recriar com `WHERE ("status" IN ('PENDING', 'CONFIRMED', 'COMPLETED') AND NOT "is_squeeze_in")` (comentário: dois normais sobrepostos continuam impossíveis; encaixe fica de fora). Agendamentos antigos ficam com `pet_id` nulo e `is_squeeze_in` falso.
- `BookInput` ganha `petId?: string | null`. Em conta pet: obrigatório para equipe e cliente (`validation` `fields.petId` "Escolha o pet."); em conta sem nicho: `petId` informado → `validation` "Esta loja não usa pets.". Leitura prévia do pet fora da transação para preço e duração; dentro da transação (sob a trava do cliente) `loadPetForBooking` de novo e `resolveServices(ctx, ids, tx, { variant: pet.variant })`.
- `itemRows` grava `variant` (a do pet, para todo item de agendamento com pet; `null` sem pet).
- `idempotencyRequestHash` acrescenta `petId` ao arranjo canônico só quando não nulo (hashes antigos não mudam).
- `AppointmentView` ganha `pet: { id: string; name: string; typeLabel: string } | null` (do pet atual) e `items[].variant: PriceVariant | null`. `loadRow` carrega o pet quando `petId` não é nulo.
- `getAvailability(ctx, q: { date; serviceIds; professionalId?; petId?: string | null; durationMin?: number })` e `listAvailableDays(ctx, q: { from; to; serviceIds; professionalId?; petId?: string | null })`: com `petId`, a duração vem da variante; cliente só com pet próprio; `durationMin` só equipe (cliente → `forbidden`), 5–720.
- Seeds e demo, ajuste mínimo: `scripts/demo-create.ts` cria um cão médio por cliente da demo (nomes em ordem: Thor, Mel, Bob, Luna, Pipoca, Fred, Nina, Max, repetindo) com `prisma` cru dentro do script e passa `petId` em cada `bookAppointment`; `prisma/seed.ts` faz o mesmo só nas contas `niche: 'PET'`. Os dois continuam rodando (`npm run demo:create`, `npm run db:seed` ou o nome atual em `package.json`) sem erro.

- [ ] **Step 1: Testes que falham** (`tests/integration/appointments-pet.test.ts`, conta pet, AGORA segunda 2026-11-16 08:00 SP, expediente 09:00–18:00, `Banho` BY_VARIANT pequeno R$ 50/60 min e grande R$ 85/90 min):
```ts
test('equipe marca para cão grande: total 8500, 90 min, item com variant DOG_LARGE e preço da linha')
test('conta pet sem petId → validation fields.petId "Escolha o pet."; conta sem nicho com petId → validation')
test('pet de outro cliente → validation fields.petId; o banco também recusa (FK composta) num insert direto')
test('cliente marca para o próprio pet; para pet de outro cliente → validation')
test('cliente com gato e gatos desligados → "A loja não atende gatos no momento."; equipe com o mesmo gato num SINGLE marca')
test('mudar o preço da linha depois não muda o agendamento já feito (foto do momento)')
test('mudar o porte do pet depois não muda o item já gravado; a visão mostra o typeLabel novo do pet')
test('getAvailability com petId usa a duração do porte (grande: 90 min → último início 16:30)')
test('getAvailability: cliente com durationMin → forbidden')
test('visão traz pet { name, typeLabel }; conta sem nicho traz pet null')
test('concluir agendamento com pet: comissão sobre o totalCents da foto; relatório soma o mesmo valor (sentido inalterado)')
```
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Migração, schema, domínio, fábrica, demo e seed.
- [ ] **Step 4:** `npx prisma generate && npm run typecheck && npx vitest run tests/integration/appointments-pet.test.ts tests/integration/appointments.test.ts tests/integration/appointments-concurrency.test.ts tests/integration/availability.test.ts tests/integration/seed.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: agendamento com pet e preço do porte guardado no item`

### Task 8: Regras só para o cliente — confirmação e duração livre da equipe

**Files:**
- Create: `src/server/domain/scheduling/staff-issues.ts`, `tests/setup/agenda.ts`
- Modify: `src/server/domain/scheduling/placement.ts`, `src/server/domain/scheduling/appointments.ts`
- Test: `tests/integration/staff-confirmation.test.ts`; atualizar `tests/integration/appointments.test.ts`, `tests/integration/agenda-limits.test.ts`, `tests/integration/painel-agenda-actions.test.ts`, `tests/integration/painel-reschedule-action.test.ts`, `tests/integration/outbox.test.ts` onde esperavam a recusa antiga da equipe

**Interfaces:**
- `staff-issues.ts`:
```ts
export type ConfirmIssueKind = 'closed' | 'outside_hours' | 'blocked' | 'busy'
export type ConfirmIssue = { kind: ConfirmIssueKind; key: string; text: string }
export async function staffIssues(ctx: TenantContext, db: Db, i: { professionalId: string; startsAt: Date; endsAt: Date; ignoreAppointmentId?: string }): Promise<ConfirmIssue[]>
export function acknowledgementOf(i: { professionalId: string; startsAt: Date; endsAt: Date; issues: readonly ConfirmIssue[] }): string
export function needsConfirmation(i: { professionalId: string; professionalName: string; issues: ConfirmIssue[]; acknowledgement: string; nearest: NearestSlot[] }): DomainError
export type NearestSlot = { startsAt: Date; label: string; date: string }
```
  - Ordem e textos: `closed` (chave `closed:<data>`, "Loja fechada neste dia"); `outside_hours` (`outside:<professionalId>:<data>`, `Fora do expediente de ${nome}` — fora quando o intervalo não cabe inteiro numa faixa do expediente do dia local, ou cruza a meia-noite, ou o dia não tem expediente); `blocked` (`blocked:<id>`, `Agenda de ${nome} bloqueada das 12:00 às 13:00` + ` (${motivo})` quando há motivo); `busy` (`busy:<id>`, `${início}–${fim} já tem ${pet?.name ?? cliente.name} (${serviços unidos por " + "})`, em ordem de início; conta agendamentos ativos normais E encaixes).
  - `acknowledgementOf`: SHA-256 hex dos primeiros 32 caracteres de `JSON.stringify([professionalId, startsAt.getTime(), endsAt.getTime(), chaves ordenadas])`.
  - `needsConfirmation`: `DomainError('conflict', 'Confira o horário antes de salvar.', { reason: 'needs_confirmation', details: { issues, acknowledgement, professionalId, professionalName, nearest } })`.
- `placeAppointment(ctx, tx, p: Place & { acknowledged?: string }): Promise<{ professionalId: string }>` — cliente: igual a hoje. Equipe: profissionais elegíveis sem nenhum conflito → regra de carga atual; nenhum livre → o de menos conflitos (desempate: carga, ordem de exibição, id); se `acknowledged !== acknowledgementOf(...)` → `throw needsConfirmation(...)` com `nearest` calculado como `slotTaken` faz hoje (melhor esforço); igual → aceita. `assertFreeForStaff` sai (o ajuste passa a usar `staffIssues`).
- Entradas ganham, só para equipe (cliente → `forbidden` "A duração é definida pelos serviços."): `durationMin?: number` (inteiro 5–720, `validation` `fields.durationMin` "Use de 5 a 720 minutos.") e `acknowledged?: string` (cliente: ignorado):
  - `BookInput`: duração = `durationMin ?? soma dos itens`; `totalDurationMin` e `endsAt` seguem a duração.
  - `rescheduleAppointment(ctx, id, i: { startsAt; professionalId?; serviceIds?; durationMin?; acknowledged? })`: duração = `durationMin ?? (serviços novos ? soma : row.totalDurationMin)`.
  - `adjustAppointment(ctx, id, i: { serviceIds?; petId?: string; durationMin?; totalCents?; notes?; acknowledged? })`: início fixo; trocar `petId` (pet ativo do mesmo cliente) refaz os itens com a variante nova; serviços ou pet mudando refazem o total (salvo `totalCents` informado); conta pet com agendamento antigo sem pet e serviços mudando → `validation` `fields.petId` "Escolha o pet."; fim muda → `staffIssues` + confirmação (texto de bloqueio customizado atual sai).
- `tests/setup/agenda.ts`: `confirmando<T>(run: (ack?: string) => Promise<T>): Promise<T>` — chama sem `ack`; se vier `needs_confirmation`, chama de novo com `details.acknowledgement`.

- [ ] **Step 1: Testes que falham** (`tests/integration/staff-confirmation.test.ts`, conta pet; Ana com expediente segunda 09:00–18:00; Rex com Banho 14:00–15:00):
```ts
test('equipe marca em cima de Rex: needs_confirmation com "14:00–15:00 já tem Rex (Banho)" e nada gravado')
test('com o acknowledgement devolvido, grava')
test('fora do expediente: issue "Fora do expediente de Ana"; dia fechado: "Loja fechada neste dia"; bloqueio: "Agenda de Ana bloqueada das 12:00 às 13:00 (Almoço)"')
test('vários conflitos vêm na ordem closed, outside_hours, blocked, busy')
test('impressão vencida: outro agendamento entra no mesmo horário entre o pedido e a confirmação → needs_confirmation de novo com 2 issues busy, nada gravado') // Review Focus 5
test('impressão não serve para outro horário nem para outro profissional')
test('equipe marca às 14:07 (fora da grade) sem conflito: grava sem pedir nada')
test('equipe escolhe duração 47 min: totalDurationMin 47 e endsAt início+47; 4 e 721 → validation fields.durationMin')
test('cliente com durationMin → forbidden; cliente nunca recebe needs_confirmation (continua slot_taken/slot_unavailable)')
test('remarcar com durationMin 200 que invade bloqueio pede confirmação; confirmado grava')
test('ajustar só a duração: encurtar grava direto; alongar sobre outro pede confirmação')
test('ajustar trocando o pet de médio para grande refaz itens e total pelo porte novo')
test('qualquer um: Ana ocupada, Bia livre → grava com Bia sem pedir; as duas ocupadas → pede com o profissional de menos conflitos')
```
Atualize os testes antigos que esperavam `slot_taken`/`blocked` da EQUIPE ou aceitação silenciosa fora do expediente: passam a esperar `needs_confirmation` (ou usam `confirmando`). Os casos de CLIENTE ficam como estão.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/staff-confirmation.test.ts tests/integration/appointments.test.ts tests/integration/agenda-limits.test.ts tests/integration/painel-agenda-actions.test.ts tests/integration/painel-reschedule-action.test.ts tests/integration/outbox.test.ts tests/integration/appointments-concurrency.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: equipe marca com qualquer horário e duração, confirmando conflitos`

### Task 9: Encaixe e promoção

**Files:**
- Create: `src/server/domain/scheduling/squeeze-in.ts`, `tests/setup/encaixe.ts`
- Modify: `src/server/domain/scheduling/appointments.ts`, `src/server/domain/scheduling/appointment-status-ops.ts`, `src/server/domain/scheduling/appointment-view.ts`, `docs/ARQUITETURA.md` (seção "Travas", item Agenda)
- Test: `tests/integration/squeeze-in.test.ts`, `tests/integration/squeeze-in-concurrency.test.ts`

**Interfaces:**
```ts
export async function overlapsNormal(db: TenantTx, i: { professionalId: string; startsAt: Date; endsAt: Date; ignoreAppointmentId?: string }): Promise<boolean>
// existe agendamento do profissional com status em ACTIVE_STATUSES, isSqueezeIn = false, intervalo [) sobreposto
export async function promoteSqueezeIns(tx: TenantTx, ctx: TenantContext, i: { professionalId: string; startsAt: Date; endsAt: Date }): Promise<string[]>
// encaixes ativos do profissional que se sobrepõem a [startsAt, endsAt), em ordem (startsAt, id); cada um que não sobrepõe
// nenhum normal (relido a cada passo, contando os já promovidos) vira normal; audit 'appointment.squeeze_in_promoted'; devolve os ids
```
- `undoOutcome(ctx: TenantContext, id: string, opts?: { acknowledged?: string }): Promise<AppointmentView>`.
- `AppointmentView` ganha `isSqueezeIn?: boolean` — só na visão da equipe (a chave não existe para o cliente, como `commissionCents`).

Pontos de chamada (todos dentro da transação que já tem a trava do profissional; a promoção não pede trava nova):
- Marcar: `isSqueezeIn` = equipe ? `overlapsNormal(novo intervalo)` : `false`.
- Remarcar: calcule a marca nova primeiro (equipe: `overlapsNormal` ignorando o próprio; cliente: `false`), grave, depois, se o agendamento era normal e ativo, `promoteSqueezeIns(profissional antigo, intervalo antigo)`.
- Ajustar: se o fim ou a marca mudam, mesmo esquema (marca nova, gravar, promover o intervalo antigo se era normal).
- Mudança de situação (`applyChange`): saindo de ativo (CANCELED, NO_SHOW) e era normal → promover o intervalo dele. Desfazer NO_SHOW → CONFIRMED: `staffIssues` só com `busy`; houver algum e `acknowledged` não bater → `needsConfirmation`; grava `isSqueezeIn = overlapsNormal(...)`. Desfazer COMPLETED → CONFIRMED: sem confirmação, marca inalterada.
- `docs/ARQUITETURA.md`: na linha da Agenda, acrescente "a reavaliação de encaixes roda sob as mesmas travas de profissional (nenhuma trava nova)"; descreva em uma frase a restrição `appointments_no_overlap` só entre normais.
- `tests/setup/encaixe.ts`: `invariantesDoEncaixe(businessId: string): Promise<string[]>` — com `prisma` cru, lista violações de: (a) dois normais ativos sobrepostos do mesmo profissional; (b) encaixe ativo que não sobrepõe nenhum normal ativo do mesmo profissional. Vazio = ok.

- [ ] **Step 1: Testes que falham** (`tests/integration/squeeze-in.test.ts`, conta pet; AGORA segunda 08:00; ao fim de cada teste `expect(await invariantesDoEncaixe(b.id)).toEqual([])`):
```ts
test('equipe confirma em cima de um normal → grava isSqueezeIn true')
test('sobrepõe só um encaixe → fica normal (mas pediu confirmação)')
test('fora do expediente sem sobreposição → normal')
test('promove em ordem de início contando os já promovidos', async () => {
  // N 10:00–11:30 normal; A 10:00–11:00 encaixe; B 10:30–11:30 encaixe; cancelar N
  // A.isSqueezeIn false, B.isSqueezeIn true, audit squeeze_in_promoted só para A
}) // Review Focus 1
test('faltou no normal promove o encaixe; concluir não promove')
test('remarcar o normal para outro horário promove o encaixe que ficou; remarcar para outro profissional também')
test('remarcar o encaixe para horário livre: vira normal; o normal que ficou não muda')
test('encurtar o normal (ajuste de duração) promove o encaixe que deixou de sobrepor')
test('alongar o normal sobre outro normal: pede confirmação e vira encaixe; o encaixe do intervalo antigo é reavaliado')
test('desfazer falta: N faltou, S promovido; undo de N pede confirmação; confirmado, N vira encaixe') // Review Focus 3
test('desfazer concluído nunca pede confirmação')
test('cliente cancela o próprio normal: o encaixe de outro cliente é promovido')
test('cliente nunca vê encaixe: horário ocupado só por encaixe não aparece em getAvailability; a visão do cliente não tem a chave isSqueezeIn')
test('cliente remarca o próprio encaixe para horário livre: vira normal')
test('cliente não consegue marcar no horário de um encaixe (slot_taken)')
```
`tests/integration/squeeze-in-concurrency.test.ts` (padrão de `appointments-concurrency.test.ts`):
```ts
test('duas marcações da equipe no mesmo horário livre, ao mesmo tempo, sem confirmação: 1 normal gravado, a outra needs_confirmation') // Review Focus 2
test('banco: dois normais sobrepostos por insert direto → erro 23P01 appointments_no_overlap; normal + encaixe → passa') // Review Focus 2
test('10 encaixes confirmados em paralelo sobre o mesmo normal: todos gravam como encaixe e as invariantes valem')
test('cancelar o normal e confirmar um encaixe em paralelo: invariantes valem em qualquer ordem (repita 5 vezes)')
test('20 clientes simultâneos no mesmo horário: exatamente 1 passa (o teste antigo continua verde)')
```
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm run typecheck && npx vitest run tests/integration/squeeze-in.test.ts tests/integration/squeeze-in-concurrency.test.ts tests/integration/appointments.test.ts tests/integration/appointments-concurrency.test.ts tests/integration/staff-confirmation.test.ts tests/integration/loyalty-redemptions.test.ts tests/integration/outbox.test.ts tests/integration/appointment-privacy.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: encaixe na agenda da equipe com promoção quando o normal sai`

---

## Grupo D — Telas de cadastro

### Task 10: "Animais atendidos" e o passo "Nicho" do dev

**Files:**
- Modify: `src/app/app/painel/configuracoes/{page.tsx,Formularios.tsx,actions.ts}`, `src/server/domain/platform/businesses.ts` (`criarSchema`, `createBusiness`, visão da conta), `src/app/dev/(app)/contas/nova/{fields.ts,Wizard.tsx,actions.ts}`, `src/app/dev/(app)/contas/[id]/layout.tsx` (ou o cabeçalho da conta), `src/ui/styles/wizard.css`
- Test: `tests/integration/painel-settings-actions.test.ts`, `tests/integration/dev-create-account-action.test.ts`, `tests/integration/platform-businesses.test.ts`, `tests/unit/dev-wizard.test.tsx` (ou o teste do assistente existente)

**Interfaces:**
- Configurações: seção nova `{ id: 'animais', label: 'Animais' }`, só para quem tem `manage_settings` e só com `painel.niche !== null`. Conteúdo: título "Animais atendidos"; texto "Cães são sempre atendidos."; `Switch` "Atende gatos" (campo `servesCats`, versão em campo escondido como em `salvarRegras`); ajuda "Desligado: os clientes não marcam horário para gatos e a tabela de preços esconde a linha de gato. A equipe ainda pode marcar. Nada é apagado.". Ação `salvarAnimais = tenantAction('manage_settings', …)` chama `updateNicheOptions`; sucesso "Animais atendidos salvos."; versão velha → a mensagem de conflito usada hoje pelas outras seções.
- `createBusiness(admin, i)` passa a exigir `niche: 'PET'` e aceitar `nicheOptions?: { servesCats: boolean }` (padrão `{ servesCats: false }`), gravados no `business.create` e no `settings.create`. A visão da conta no dev ganha `niche: NicheKey | null` e `servesCats: boolean`.
- Assistente: `WizardValues.servesCats: boolean` (vazio `false`); passo `{ id: 'nicho', label: 'Nicho' }` na posição do antigo "Termos" (3º). Corpo: grupo `role="radiogroup"` `aria-label="Nicho da conta"` com um único cartão `role="radio" aria-checked="true" aria-disabled="true"` "Pet shop" (ícone `PawPrint`, texto "Agenda com pets, porte e preço por animal."), destacado em Caramelo (borda `--accent`, fundo `--accent-tint`, selo "Selecionado" com `Check`), clique e teclado não desmarcam; nota "Por enquanto, o Agenda Flui atende pet shops."; `Switch` "Atende gatos" com ajuda "Desligado: a loja atende só cães. Dá para mudar depois em Configurações.". Resumo final mostra "Nicho: Pet shop · Gatos: sim|não". `criarConta` envia `niche: 'PET'` e `nicheOptions`.
- Cabeçalho da conta no dev: chip "Pet shop" e "Atende gatos"/"Só cães" (conta sem nicho: "Sem nicho").

- [ ] **Step 1: Testes que falham**:
```ts
// painel-settings-actions
test('salvarAnimais liga gatos e responde "Animais atendidos salvos."; profissional recebe a mensagem de sem permissão')
test('salvarAnimais com versão velha → mensagem de conflito, nada muda')
// dev-create-account-action / platform-businesses
test('criarConta grava niche PET e servesCats do formulário')
test('createBusiness sem niche → validation')
// assistente (unit, testing-library)
test('passo Nicho: o cartão Pet shop está marcado e clicar não desmarca; o switch "Atende gatos" muda o valor enviado')
```
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar (CSS do cartão no `wizard.css`, com `transform: scale(.98)` ao toque sob `prefers-reduced-motion: no-preference`). **Step 4:** `npm run typecheck && npx vitest run <os quatro arquivos>` → PASS.
- [ ] **Step 5: Commit** — `feat: animais atendidos nas configurações e passo Nicho no dev`

### Task 11: Pets na ficha do cliente

**Files:**
- Create: `src/ui/components/pet-illustrations.tsx`, `src/ui/components/PetCard.tsx`, `src/ui/components/PetTypePicker.tsx`, `src/ui/styles/pets.css`; `src/app/app/painel/clientes/[id]/pets/{PetForm.tsx,actions.ts}`, `src/app/app/painel/clientes/[id]/pets/novo/{page.tsx,loading.tsx}`, `src/app/app/painel/clientes/[id]/pets/[petId]/{page.tsx,loading.tsx}`, `src/app/app/painel/clientes/[id]/pets/[petId]/foto/route.ts`
- Modify: `src/ui/components/index.ts`, `src/ui/ui.css` (importa `pets.css` depois de `painel.css`), `src/app/app/painel/clientes/[id]/page.tsx`
- Test: `tests/integration/painel-pets-actions.test.ts`, `tests/unit/ui/PetTypePicker.test.tsx`, `tests/unit/ui/PetCard.test.tsx`

**Interfaces:**
- `pet-illustrations.tsx`: `PetIllustration({ variant, size = 48 }: { variant: PriceVariant; size?: number })` — SVG em traço (stroke `currentColor`, 1.75, cantos redondos, estilo Lucide), cinco desenhos: cães de tamanhos crescentes e um gato; `aria-hidden`.
- `PetTypePicker({ name, servesCats, staffMayPickCat, value, onChange })` com `value: { species: PetSpecies; size: PetSize | null }`: cartões de seleção (`role="radio"`), primeiro Cão/Gato (Gato só aparece com `servesCats` ou `staffMayPickCat`; com gatos desligados e equipe, ajuda "A loja não atende gatos no momento. Só a equipe marca para gatos."), depois os quatro portes com ilustração, rótulo curto e faixa ("Médio · 10 a 25 kg"); campos escondidos `species` e `size`. Setas movem a seleção; seleção anima `scale` sob `prefers-reduced-motion: no-preference`.
- `PetCard({ pet, href?, actions? }: { pet: PetView; href?: string; actions?: ReactNode })`: foto (ou ilustração do porte em círculo `--brand-tint`), nome, `typeLabel · rangeLabel`, raça, idade, pelagem, cuidados como texto de até 2 linhas; arquivado com selo "Arquivado".
- Ficha do cliente: seção "Pets" (`Card as="section"`, primeira depois de "Resumo"), só com `painel.niche`; grade de `PetCard` (1 coluna até 560 px, 2 acima); botão "Adicionar pet" (`manage_clients`); estado vazio `EmptyState` "Nenhum pet ainda" + "Adicione o primeiro para marcar horários."; link "Ver arquivados (n)" quando houver.
- `PetForm` (client, `PainelForm`): Nome; `PetTypePicker`; Raça (`Input` com `datalist` das sugestões da espécie); Nascimento aproximado (`type="month"`, ajuda "Mês e ano, mais ou menos."); Pelagem (três chips Curta/Média/Longa); Cuidados e comportamento (`Textarea` + chips rápidos de `careQuickOptions` que acrescentam o texto); botão "Salvar pet"/"Adicionar pet".
- Ações (`tenantAction('manage_clients')`): `criarPet` (redireciona para `/painel/clientes/<id>/pets/<petId>?novo=1`), `editarPet`, `arquivarPet`, `restaurarPet`. Página de edição: formulário, foto (`AvatarUpload` ou o padrão de `equipe/[id]` com a rota `foto/route.ts`, que espelha `equipe/[id]/foto/route.ts` e volta com `?foto=<código>`), e "Arquivar pet" com `ConfirmDialog` ("Arquivar Thor? Ele some das marcações; o histórico fica."). Com `?novo=1`: aviso "Pet adicionado. Quer pôr uma foto?".
- Quem só tem `view_clients` vê a seção e as páginas sem botões de escrita.

- [ ] **Step 1: Testes que falham**:
```ts
// painel-pets-actions (padrão de painel-customers-actions.test.ts, guards mockados)
test('criarPet grava cão grande e redireciona para a página do pet com ?novo=1')
test('criarPet de cão sem porte devolve fields.size "Escolha o porte."')
test('profissional recebe sem permissão em criarPet; editarPet de pet de outra conta → não encontrado')
test('arquivarPet e restaurarPet mudam archived')
test('rota de foto: arquivo grande demais volta com ?foto=too_large')
// unit
test('PetTypePicker: sem servesCats e sem staffMayPickCat não mostra Gato; escolher Gato esconde os portes e limpa size')
test('PetTypePicker: mostra "Médio" e "10 a 25 kg" e marca aria-checked no escolhido')
test('PetCard mostra "Cão médio · 10 a 25 kg" e o selo Arquivado')
```
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar (estados: `loading.tsx` com `Skeleton` no formato dos cartões; erro de ação no topo pelo `PainelForm`). **Step 4:** `npm run typecheck && npx vitest run tests/integration/painel-pets-actions.test.ts tests/unit/ui/PetTypePicker.test.tsx tests/unit/ui/PetCard.test.tsx tests/integration/painel-customers-actions.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: pets na ficha do cliente no painel`

### Task 12: Serviços com preço por porte no painel

**Files:**
- Modify: `src/app/app/painel/servicos/{page.tsx,ServicosPainel.tsx,actions.ts}`, `src/ui/styles/painel.css`
- Test: `tests/integration/painel-services-actions.test.ts`, `tests/unit/ui/ServicoPrecos.test.tsx`

**Interfaces:**
- `page.tsx` passa a `ServicosPainel` o contexto `{ step, loyalty, niche: { servesCats: boolean } | null }`.
- No formulário (só com nicho): `Tabs`/controle segmentado "Preço único" | "Por animal e porte" (campo `pricingMode`). "Preço único" = campos atuais. "Por animal e porte" = componente `ServicoPrecos` (no mesmo arquivo ou `servicos/ServicoPrecos.tsx`): uma linha por variante visível (`visibleVariants`) com `PetIllustration`, rótulo "Pequeno · até 10 kg", caixa "Atende", `MoneyField` (`v_<VARIANT>_price`) e `DurationField` (`v_<VARIANT>_duration`, grade da conta); linha desmarcada fica esmaecida e sem campos obrigatórios. Até 560 px cada linha vira um cartão empilhado. Com gatos desligados e linha de gato gravada: nota "A linha de gato fica guardada enquanto a loja não atende gatos." Voltar para "Preço único" com linhas gravadas mostra aviso "Ao salvar, os preços por porte serão apagados.".
- `actions.ts`: `entrada(v)` monta `pricingMode` e `variantPrices` das linhas marcadas (preço vazio numa linha marcada → `erroDeCampo('v_<VARIANT>_price', 'Informe o preço.')`); erros do domínio `variantPrices`/`pricingMode` caem no topo do formulário.
- Lista de serviços: `BY_VARIANT` mostra "Por porte · a partir de R$ 50,00" (`fromPrice` com `servesCats` da conta) e "4 portes"/"3 portes e gato".

- [ ] **Step 1: Testes que falham**:
```ts
test('criarServico por porte com pequeno e grande grava duas linhas')
test('criarServico por porte sem nenhuma linha marcada → mensagem "Preencha o preço de pelo menos um porte."')
test('linha marcada sem preço → fields v_DOG_SMALL_price "Informe o preço."')
test('editarServico com gatos desligados mantém a linha de gato gravada')
test('ServicoPrecos: sem servesCats não renderiza a linha Gato; desmarcar "Atende" desabilita os campos da linha')
```
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** `npm run typecheck && npx vitest run tests/integration/painel-services-actions.test.ts tests/unit/ui/ServicoPrecos.test.tsx` → PASS.
- [ ] **Step 5: Commit** — `feat: tabela de preço por animal e porte na tela de serviços`

---

## Grupo E — Telas da agenda e fecho

### Task 13: Planner com pet e encaixe, e o encanamento da confirmação

**Files:**
- Create: `src/app/app/painel/agenda/ConflitosDialog.tsx`, `src/app/app/painel/agenda/ConflitosAviso.tsx`
- Modify: `src/server/domain/scheduling/agenda-page.ts`, `src/ui/components/{AppointmentSlip.tsx,PlannerWeek.tsx,PlannerDay.tsx}`, `src/ui/styles/planner.css`, `src/app/_lib/form-state.ts`, `src/app/app/painel/_lib/PainelForm.tsx`
- Test: `tests/integration/painel-agenda-page.test.ts`, `tests/unit/form-state.test.ts` (ou o teste existente de `formError`), `tests/unit/ui/AppointmentSlip.test.tsx`, `tests/unit/ui/Conflitos.test.tsx`

**Interfaces:**
- `agenda-page.ts`: `PageSlip` += `petName: string | null`, `squeezeIn: boolean`; `PageWeekDay.items[]` += `petName: string | null`, `squeezeIn: boolean`; `PageDetail` += `pet: { id: string; name: string; typeLabel: string } | null`, `squeezeIn: boolean`, `items[].variant`; `AgendaPage` += `niche: { servesCats: boolean } | null`. A visão dia continua usando `layoutDay` (sobrepostos lado a lado em faixas); garanta que encaixe e normal do mesmo intervalo caem em faixas diferentes (teste).
- `form-state.ts`: `export type Confirmacao = { ack: string; professionalName: string; issues: { kind: 'closed' | 'outside_hours' | 'blocked' | 'busy'; text: string }[] }`; `FormState` += `confirmation?: Confirmacao`; `formError` lê `reason === 'needs_confirmation'` (e também preenche `conflict.nearest` a partir de `details.nearest`, como já faz para `slot_taken`).
- `PainelForm` aceita `id?: string` (vai para o `<form>`).
- `ConflitosDialog({ formId, confirmation, confirmLabel, onBack })`: `Dialog` "Confirme o horário" com a lista (ícones `DoorClosed` closed, `Clock` outside_hours, `Ban` blocked, `CalendarClock` busy; texto do servidor; quando há `busy`, linha final "Vai ficar como encaixe se sobrepor outro atendimento."), botões "Voltar" e `<button type="submit" form={formId} name="ack" value={ack}>` com `confirmLabel` ("Marcar mesmo assim", "Remarcar mesmo assim", "Salvar mesmo assim"). Abre a cada `ack` novo; "Voltar" fecha sem limpar o formulário.
- `ConflitosAviso({ confirmation })`: o mesmo conteúdo em painel de aviso dentro de um formulário que já é diálogo (remarcação por arrasto), com `<input type="hidden" name="ack">`.
- `AppointmentSlip`: com `squeezeIn`, classe `af-slip--squeeze` (borda tracejada `--accent`, faixa `--accent-tint`) e selo "Encaixe"; nome principal `petName ?? customerName`, segunda linha `customerName · serviços` quando há pet; `aria-label` acrescenta ", encaixe".
- `PlannerWeek`: item mostra `petName ?? customerName` e selo "Encaixe".
- `PlannerDay`: recebe `step={5}` de quem chama para o arrasto (início livre da equipe).

- [ ] **Step 1: Testes que falham**:
```ts
// painel-agenda-page
test('fatia do dia traz petName e squeezeIn; normal e encaixe sobrepostos ficam em lanes 0 e 1 com lanes 2')
test('detalhe traz pet { name, typeLabel } e squeezeIn')
// form-state
test('formError de needs_confirmation devolve confirmation { ack, professionalName, issues } e conflict.nearest')
// ui
test('AppointmentSlip de encaixe mostra "Encaixe" e o aria-label termina com ", encaixe"')
test('ConflitosDialog lista os textos e o botão envia name=ack value=<ack> no formulário indicado')
```
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** `npm run typecheck && npx vitest run <os arquivos acima> tests/unit/agenda-layout.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat: planner com pet e marca de encaixe, e confirmação de conflitos nos formulários`

### Task 14: Folha de marcar com pet, duração livre e confirmação

**Files:**
- Create: `src/ui/components/MinutesField.tsx`
- Modify: `src/app/app/painel/agenda/{BookingSheet.tsx,HorarioFields.tsx,AppointmentSheet.tsx,RescheduleSheet.tsx,ConfirmarRemarcacao.tsx,AgendaPainel.tsx,actions.ts,consultas.ts}`, `src/ui/components/index.ts`, `src/ui/styles/painel.css`
- Test: `tests/integration/painel-agenda-actions.test.ts`, `tests/integration/painel-reschedule-action.test.ts`, `tests/integration/painel-agenda-consultas.test.ts`, `tests/unit/ui/MinutesField.test.tsx`

**Interfaces:**
- `consultas.ts`:
```ts
export type PetResumo = { id: string; name: string; typeLabel: string; variant: PriceVariant }
export type ClienteBusca = { id: string; name: string; phoneLabel: string | null; pets: PetResumo[] }
export async function buscarClientes(termo: string): Promise<Pedido<{ clientes: ClienteBusca[] }>>   // pets via listPetsByCustomers
export async function cadastrarClienteRapido(p: { nome: string; telefone: string; pet?: { name: string; species: PetSpecies; size: PetSize | null } }): Promise<Pedido<{ cliente: ClienteBusca }>>  // com pet → createCustomerWithPet
export async function adicionarPetRapido(customerId: string, pet: { name: string; species: PetSpecies; size: PetSize | null }): Promise<Pedido<{ pet: PetResumo }>>
export type ServicoDoPet = { id: string; name: string; offered: boolean; priceCents: number | null; durationMin: number | null; reason: string | null }
export async function servicosDoPet(petId: string): Promise<Pedido<{ servicos: ServicoDoPet[] }>>
export async function petsDoCliente(customerId: string): Promise<Pedido<{ pets: PetResumo[] }>>
export async function buscarHorarios(p: { serviceIds: string[]; date: string; professionalId: string; petId?: string; durationMin?: number }): Promise<Pedido<{ horarios: HorarioLivre[]; durationMin: number }>>
```
- `actions.ts`: `marcarHorario` lê `petId`, `durationMin`, `ack`; `ajustarAtendimento` lê `petId`, `durationMin`, `ack` (só envia o que mudou, como hoje); `remarcarAtendimento` lê `durationMin`, `ack`; `mudarSituacao` com `to=undo` lê `ack`. `durationMin` vazio = não enviar; não numérico → `erroDeCampo('durationMin', 'Use de 5 a 720 minutos.')`.
- `MinutesField({ id, name, value, onChange, sumMin, error })`: `Input type="number"` `min=5 max=720 step=1` `inputMode="numeric"`, sufixo "min", ajuda `Soma dos serviços: ${formatDuration(sumMin)}.`, botão ghost "Usar a soma" quando `value !== sumMin`.
- `BookingSheet`, na ordem: Cliente (busca; resultados mostram os pets em texto curto "Thor, Mel"; cadastro rápido com nome, telefone e — com nicho — nome do pet + `PetTypePicker` compacto com `staffMayPickCat`); Pet (cartões de rádio com ilustração e `typeLabel`; "Adicionar pet" abre o mini formulário inline que chama `adicionarPetRapido`; cliente sem pets: "Este cliente ainda não tem pet. Adicione um para marcar."); Serviços (de `servicosDoPet`: rótulo `${nome} · ${duração} · ${preço}` do porte; não oferecido desabilitado com o `reason`; esqueleto enquanto carrega; erro com "Tentar de novo"); Duração (`MinutesField`, começa na soma e acompanha a soma até a pessoa editar); Profissional; `HorarioFields` (passa `petId` e `durationMin`; o texto do "Outro horário" vira "Você pode usar qualquer horário. Se cair em cima de outro atendimento, fora do expediente ou num bloqueio, você confirma antes."); Observação. Total em destaque no rodapé da folha ("Total R$ 85,00 · 1 h 30 min"). Sem nicho: sem a etapa Pet, serviços da página como hoje. `PainelForm id="marcar-form"`; `needs_confirmation` → `ConflitosDialog` com "Marcar mesmo assim"; sucesso fecha a folha e mostra o toast atual (mensagem "Horário marcado: Thor (Marina), 14:00." quando há pet).
- `AppointmentSheet`: cabeçalho com pet (ilustração, nome, `typeLabel`) e selo "Encaixe" quando `squeezeIn`; no ajuste: troca de pet (de `petsDoCliente`), serviços com preço do porte, `MinutesField`; confirmação por `ConflitosDialog` "Salvar mesmo assim"; desfazer falta pede confirmação pelo mesmo diálogo.
- `RescheduleSheet`: `MinutesField` (começa na duração atual) e `ConflitosDialog` "Remarcar mesmo assim". `ConfirmarRemarcacao` (arrasto): `ConflitosAviso` dentro do diálogo e o botão vira "Remarcar mesmo assim" quando há confirmação pendente.
- `AgendaPainel`: passa `step={5}` ao `PlannerDay`.

- [ ] **Step 1: Testes que falham**:
```ts
// painel-agenda-actions
test('marcarHorario com petId e durationMin 47 grava 47 min e responde "Horário marcado: Thor (Marina), 14:00."')
test('marcarHorario sobre outro atendimento devolve confirmation com "14:00–15:00 já tem Rex (Banho)"; reenviar com ack grava como encaixe')
test('marcarHorario em conta pet sem petId devolve fields.petId "Escolha o pet."')
test('ajustarAtendimento trocando o pet refaz o total pelo porte novo')
test('mudarSituacao undo de falta sobre normal devolve confirmation; com ack, reabre como encaixe')
// painel-reschedule-action
test('remarcarAtendimento para horário ocupado devolve confirmation; com ack grava; ack de outro horário pede de novo')
// painel-agenda-consultas (requireTenant mockado)
test('servicosDoPet marca não oferecido com reason "Não atende Cão gigante"')
test('cadastrarClienteRapido com pet cria cliente e pet; pet inválido não deixa cliente')
test('buscarClientes traz os pets de cada cliente e acha pelo nome do pet')
// unit
test('MinutesField: "Usar a soma" só aparece quando o valor difere da soma e volta o valor para a soma')
```
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar (folha legível a 360 px: cartões de pet em rolagem horizontal com `scroll-snap`; foco visível em todo controle novo). **Step 4:** `npm run typecheck && npx vitest run <os quatro arquivos>` → PASS.
- [ ] **Step 5: Commit** — `feat: marcar com pet, duração livre e confirmação na agenda do painel`

### Task 15: Fecho, documentação e verificação completa

**Files:**
- Modify: `docs/ARQUITETURA.md` (parágrafo curto "Nicho": registro em `src/server/niches/`, `getNicheSettings`, `requirePetNiche`, elegibilidade única em `catalog/pricing.ts`; "Agenda": regras do cliente vs equipe, `needs_confirmation`, encaixe — só o que faltar depois da Tarefa 9), `docs/superpowers/pendencias-proximas-fases.md` (marca o que a fase 2 entregou; anota para a fase 3: quiz usa `NICHES.PET.quiz`, área do cliente usa `listMyPets`, `listServicesForPet`, `fromPrice`, `getAvailability({ petId })`; para a fase 4: `serviceSuggestions` e demo com pets de portes variados e um encaixe)
- Test: suíte inteira

- [ ] **Step 1: Varredura de textos** — `rg -n -i "tutor|tosador|patinhas" src/app src/ui src/server/niches` não acha texto de tela novo (o rótulo de ícone existente "Patinha" em `src/shared/service-icons.ts` não é desta fase; não mexa).
- [ ] **Step 2: Conferir seeds e demo** — com o banco local de pé (`npm run db:start`), rode o seed e `npm run demo:create`; se o banco não estiver de pé, registre no relatório que não rodou.
- [ ] **Step 3: Verificação completa**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: tudo verde, sem aviso novo.

- [ ] **Step 4: Commit** — `docs: nicho pet e encaixe na arquitetura e pendências da próxima fase`
