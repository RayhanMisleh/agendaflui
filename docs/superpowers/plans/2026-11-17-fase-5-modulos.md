# AgendaFlui — Fase 5: Módulos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar os quatro módulos opcionais (Fidelidade, Banners, Loja com pagamento e frete, Vouchers) no domínio, na API `v1` do app e nas telas do painel do negócio, mais a aba Integrações da conta no painel dev, com módulo desligado sumindo de menu, telas e rotas sem perder dados.

**Architecture:** Cada módulo é uma pasta de domínio (`src/server/domain/{loyalty,banners,store,vouchers}/`) que recebe `ctx`, confere o módulo ligado (`requireModule`) e a capacidade, e é a única fonte de regra para o painel e para a API. Serviços externos (Mercado Pago, Frenet, ViaCEP) ficam atrás de interfaces em `src/server/integrations/`, com implementação falsa usada em testes e em desenvolvimento; credenciais por conta ficam cifradas em `business_integrations` (modelo de plataforma, inacessível por `tenantDb`). Dinheiro e pontos são sempre recalculados no servidor e gravados com chaves de idempotência no banco; pagamento só muda de situação depois de o servidor consultar o pagamento na API do Mercado Pago.

**Tech Stack:** a mesma das fases anteriores. Nenhuma dependência nova: as chamadas externas usam `fetch` com `AbortSignal.timeout`; cifra e assinaturas com `node:crypto` (AES-256-GCM, HKDF, HMAC-SHA256).

**Spec:** `docs/superpowers/specs/2026-11-13-agendaflui-design.md` — seções 5.3, 5.4, 6 ("Módulos opcionais" e convenções), 8.3 (pontos na conclusão), 9.1 (segredos), 9.2–9.3 (contrato da API e `module_disabled`), 10 (módulos; Vouchers exige Loja), 12.1 (aba Integrações), 12.2 (Fidelidade, Banners, Loja, Vouchers), 13 (integrações atrás de interfaces, segredos cifrados), 16. Desenho visual: `docs/superpowers/specs/2026-11-17-redesenho-marca-design.md` (a seção 11 da spec principal está superada). Pendências herdadas: `docs/superpowers/pendencias-proximas-fases.md`, seção "Fase 5". Referência só de funcionalidade (nada é copiado): `_legacy/api-legacy/src/services/{PedidoService,PaymentService,FreteService}.js`.

## Global Constraints

- Vale tudo de `AGENTS.md` e das Global Constraints da Fase 4 (`docs/superpowers/plans/2026-11-17-fase-4-painel-do-negocio.md`): TypeScript estrito, sem `any` nem `@ts-ignore`; data e hora só por `src/server/time/`; `z` de `@/server/domain/errors`; domínio de conta com `ctx.db` e `ctx.clock()`; regra de negócio só em `src/server/`; telas e ações não importam `@/server/db/client` nem `tenantDb`; textos em pt-BR, frase simples, voz ativa; termos da conta (pontos, clube, cliente, profissional) em todo rótulo; nenhum termo do sistema antigo; sem formatador automático; commits locais.
- Módulo desligado: o domínio recusa com `DomainError('module_disabled')` (API: `404` com `error.code = "module_disabled"`); a página do painel responde 404 (`notFound()`); o menu não mostra o destino; os dados ficam guardados. Exceções fixas, porque envolvem dinheiro já pago ou pontos já devidos: o webhook do Mercado Pago e a varredura de pedidos vencidos rodam com a Loja desligada; o estorno de pontos de um atendimento desfeito roda com a Fidelidade desligada.
- Capacidades novas, só dono e gerente (e o suporte): `manage_loyalty`, `manage_banners`, `manage_store`, `manage_vouchers`. O profissional não gerencia nenhum módulo; na ficha do cliente ele só LÊ saldo e extrato de pontos (`view_clients`).
- Dinheiro em centavos inteiros (`*_cents`), sempre recalculado no servidor a partir do banco; nada de preço, frete ou total vindo do cliente. Pedido e resgate guardam nome e valor do item no momento da compra. Pontos são inteiros; o saldo é SEMPRE a soma de `loyalty_transactions` (não existe coluna de saldo).
- Idempotência no banco, não só no código: toda escrita que credita ou debita pontos, reserva ou devolve estoque, registra pagamento ou gera código de voucher tem uma chave única (`dedupe_key`, `(business_id, provider_payment_id)`, `(order_item_id, seq)`, `Idempotency-Key` gravada) que torna a repetição inofensiva.
- Segredos de integração: cifrados em repouso (AES-256-GCM, chave HKDF do `APP_SECRET`, dado associado = conta + provedor + campo), nunca devolvidos a tela, API, log, auditoria, erro ou estado de formulário; a tela mostra só os 4 últimos caracteres. Quem quiser mudar digita de novo.
- Chamadas externas: só por `integrations()` (`src/server/integrations/index.ts`), com tempo limite (Mercado Pago 10 s, Frenet 8 s, ViaCEP 5 s) e erro tratado (`IntegrationError`). NENHUM teste toca a rede: testes usam as falsas (`setIntegrationsForTests`); fora de produção o padrão é a falsa (`INTEGRATIONS_MODE=fake`), em produção a real e `fake` é recusado na partida.
- Isolamento: tabela de conta tem `business_id`, `@@unique([businessId, id])` e FK composta com `business_id` para as outras tabelas de conta (escritas à mão na migração, como em `prisma/migrations/20261116120000_scheduling`); modelo classificado em `src/server/db/models.ts`; teste de outra conta em cada módulo.
- Rotas da API: `defineRoute` com `module: '<módulo>'`, entram em `src/server/api/routes-manifest.ts` (o teste do OpenAPI confere) e exportam `OPTIONS = preflight`; a única exceção é o webhook (rota simples, fora do OpenAPI, declarada no teste).
- Telas: o redesenho da marca (componentes existentes: `Card`, `DataList`, `Sheet`, `Dialog`, `ConfirmDialog`, `StatNumber`, `StatusBadge`, `StatusDot`, `EmptyHint`, `NavTabs`, `MoneyField`, `Pagination`, `SearchBar`, `Switch`, `AvatarUpload`...). Carregar a skill `frontend-design:frontend-design` antes de desenhar; componente novo entra na vitrine. 375 px, foco visível, `prefers-reduced-motion`, nada só por cor, formulários comuns sem JavaScript, ações destrutivas com confirmação, listas com mais de 50 itens paginadas no servidor com filtros na URL.
- Sem testes de navegador e sem usar navegador. Verificação: `npm run typecheck && npm run lint && npm test && npm run build && npm run smoke` (a fumaça por HTTP ganha as páginas novas de cada tarefa).
- Migração nova por mudança de banco, com data posterior a `20261118020000`; nunca editar migração antiga. Não criar documentação além do que a Tarefa 10 lista.

## Review Focus

1. **Dinheiro adulterado ou divergente**: o app manda preço, frete ou total diferentes (ou um `quoteToken` de outro carrinho, outro CEP, outra conta ou vencido) e o pedido sai com os valores do banco ou é recusado; pagamento aprovado com valor ou moeda diferentes do pedido não marca o pedido como pago (fica com `attention = amount_mismatch`). Testes nas Tarefas 6 e 7.
2. **Duplo crédito ou débito**: concluir → desfazer → concluir credita exatamente uma vez por conclusão e estorna uma vez por desfazer; dois resgates simultâneos com saldo para um só: um passa; notificação de pagamento repetida 3 vezes (inclusive em paralelo) gera um pagamento, uma baixa de reserva e os códigos de voucher uma vez; dar baixa no mesmo código duas vezes: a segunda é `conflict`. Testes nas Tarefas 3, 7 e 9.
3. **Webhook forjado ou repetido**: sem `x-signature`, com assinatura errada ou com a chave de outra conta → 401 e nenhuma consulta ao Mercado Pago; assinatura certa com pagamento cujo `external_reference` é pedido de outra conta → ignorado sem mudar nada; Mercado Pago fora do ar → 503 e nada muda; nunca usar `status` ou valor do corpo. Testes na Tarefa 7.
4. **Isolamento entre contas**: produto, endereço, cotação, pedido, prêmio, banner, voucher ou código da conta B usado com a chave ou a sessão da conta A → `not_found` (ou cotação inválida); segredo cifrado copiado para a linha de outra conta não abre. Testes nas Tarefas 2, 3, 5, 6, 7 e 9.
5. **Módulo desligado**: com o módulo desligado, cada rota do módulo devolve `404 module_disabled` antes de validar o corpo, cada página do módulo responde 404 e some do menu, e os dados voltam intactos ao religar; a Fidelidade desligada não credita pontos na conclusão; a Loja desligada ainda processa o webhook e a varredura de pedidos. Testes nas Tarefas 1, 3, 6, 7 e na fumaça.

---

## Modelo de dados (todas as tabelas de conta, salvo indicação)

Convenções da spec (§6): UUID do banco, `created_at`/`updated_at`, instantes `timestamptz(3)`, dinheiro `*_cents` inteiro com CHECK `>= 0`, arquivamento por `archived_at`. Cada linha abaixo diz a tarefa que cria a tabela.

| Tabela | Colunas principais | Restrições |
|---|---|---|
| `business_integrations` (T2, **plataforma**) | `business_id` PK→businesses (cascade), `mp_access_token_enc`, `mp_access_token_last4`, `mp_webhook_secret_enc`, `mp_webhook_secret_last4`, `mp_webhook_key` (único), `mp_updated_at`, `frenet_token_enc`, `frenet_token_last4`, `frenet_updated_at`, `version` | CHECK: `_enc` e `_last4` de cada segredo nulos juntos |
| `loyalty_transactions` (T3) | `customer_id`, `kind` (`EARN`, `EARN_REVERSAL`, `REDEEM`, `REDEEM_REVERSAL`, `ADJUST`), `points` (com sinal), `appointment_id?`, `redemption_id?`, `reason?`, `dedupe_key`, `created_by_type` (`PartyType`), `created_by_id?` | único `(business_id, dedupe_key)`; CHECK `points <> 0`; `EARN`/`REDEEM_REVERSAL` > 0, `EARN_REVERSAL`/`REDEEM` < 0; `ADJUST` exige `reason`; índice `(business_id, customer_id, created_at)` |
| `prizes` (T3) | `name`, `description?`, `image_upload_id?`, `cost_points` (> 0), `stock?` (nulo = sem limite, ≥ 0), `active`, `display_order`, `archived_at?` | |
| `prize_redemptions` (T3) | `customer_id`, `prize_id`, `prize_name`, `cost_points` (cópias), `status` (`PENDING`, `DELIVERED`, `CANCELED`), `requested_by_type`, `requested_by_id?`, `delivered_at?`, `canceled_at?`, `cancel_reason?`, `idempotency_key?`, `idempotency_request_hash?` | único parcial `(business_id, customer_id, idempotency_key)` onde a chave não é nula |
| `banners` (T4) | `title`, `image_upload_id?`, `link_url?`, `starts_on?`, `ends_on?` (date), `active`, `display_order` | CHECK `ends_on >= starts_on`; CHECK `active = false OR image_upload_id IS NOT NULL` |
| `store_settings` (T5) | PK `business_id`, `pickup_enabled` (true), `pickup_instructions?`, `shipping_enabled` (false), `origin_postal_code?`, `default_weight_grams` (1000), `default_length_cm` (20), `default_height_cm` (10), `default_width_cm` (30), `payment_window_min` (60), `version` | CHECK `pickup_enabled OR shipping_enabled`; CHECK `payment_window_min BETWEEN 15 AND 1440` |
| `product_categories` (T5) | `name`, `display_order`, `archived_at?` | único parcial `(business_id, lower(name))` onde não arquivada |
| `products` (T5) | `category_id?`, `name`, `description?`, `price_cents` (> 0), `promo_price_cents?` (> 0 e < preço), `stock` (≥ 0), `weight_grams?`, `length_cm?`, `height_cm?`, `width_cm?`, `active`, `display_order`, `archived_at?` | |
| `product_images` (T5) | `product_id`, `upload_id`, `position` | único `(product_id, position)`; até 6 por produto (domínio) |
| `addresses` (T5) | `customer_id`, `label?`, `recipient_name`, `postal_code` (8 dígitos), `street`, `number`, `complement?`, `district`, `city`, `state` (UF), `is_default` | até 10 por cliente (domínio); único parcial `(customer_id)` onde `is_default` |
| `orders` (T6) | `number` (sequencial por conta), `customer_id`, `status` (`AWAITING_PAYMENT`, `PAID`, `CANCELED`, `EXPIRED`), `fulfillment_status` (`PENDING`, `READY_FOR_PICKUP`, `SHIPPED`, `DELIVERED`), `delivery_method` (`PICKUP`, `SHIPPING`, `NONE`), `items_cents`, `shipping_cents`, `total_cents`, `shipping_service_code?`, `shipping_service_name?`, `shipping_days?`, `tracking_code?`, `ship_recipient?`, `ship_postal_code?`, `ship_street?`, `ship_number?`, `ship_complement?`, `ship_district?`, `ship_city?`, `ship_state?`, `customer_note?`, `expires_at`, `paid_at?`, `canceled_at?`, `canceled_by_type?`, `canceled_by_id?`, `cancel_reason?`, `stock_released_at?`, `attention?` (`amount_mismatch`, `stock_shortfall`, `payment_reversed`), `mp_preference_id?`, `checkout_url?`, `idempotency_key?`, `idempotency_request_hash?` | único `(business_id, number)`; CHECK `total_cents = items_cents + shipping_cents`; CHECK `total_cents > 0`; único parcial de idempotência como em `appointments`; índices `(business_id, status, expires_at)`, `(business_id, customer_id, created_at)` |
| `order_items` (T6; `voucher_id` em T9) | `order_id`, `product_id?`, `voucher_id?` (T9), `name`, `unit_price_cents`, `quantity` (1–99), `total_cents`, `position` | CHECK `total_cents = unit_price_cents * quantity`; CHECK exatamente um entre `product_id` e `voucher_id` (T9 troca o CHECK `product_id IS NOT NULL`) |
| `payments` (T7) | `order_id`, `provider` (`MERCADO_PAGO`), `provider_payment_id`, `status` (`PENDING`, `IN_PROCESS`, `APPROVED`, `REJECTED`, `CANCELED`, `REFUNDED`, `CHARGED_BACK`), `status_detail?`, `amount_cents`, `currency`, `approved_at?`, `last_synced_at` | único `(business_id, provider, provider_payment_id)` |
| `partners` (T9) | `name`, `description?`, `address?`, `phone?`, `website?`, `logo_upload_id?`, `active`, `archived_at?` | |
| `vouchers` (T9) | `partner_id`, `name`, `description?`, `terms?`, `image_upload_id?`, `price_cents` (> 0), `stock` (≥ 0), `valid_days?` (1–730), `active`, `display_order`, `archived_at?` | |
| `voucher_codes` (T9) | `voucher_id`, `order_id`, `order_item_id`, `customer_id`, `seq`, `code`, `status` (`ACTIVE`, `REDEEMED`, `VOID`), `expires_at?`, `redeemed_at?`, `redeemed_by_type?`, `redeemed_by_id?`, `voided_at?`, `void_reason?` | único `(business_id, code)`; único `(order_item_id, seq)` |

Escopos de trava novos em `src/server/db/tenant.ts` (`ESCOPOS_DE_TRAVA`): `order` (um pedido), `store` (a conta: número do pedido e ordem de produtos e categorias), `banners` (a conta: ordem), `loyalty` (a conta: ordem dos prêmios). O débito de pontos trava `customer` (o mesmo escopo que marcar, arquivar e anonimizar já usam). Estoque de produto, prêmio e voucher: `updateMany` condicional (`stock >= quantidade`) dentro da transação; contagem 0 = sem estoque.

## Mapa de arquivos

```
src/shared/modules.ts                              MODULE_NAMES, ModuleName, rótulos
src/server/domain/modules.ts                       isModuleOn, requireModule
src/server/auth/secret-box.ts                      cifra de segredos de integração
src/server/domain/platform/integrations.ts         aba Integrações (ator admin)
src/server/domain/platform/integration-secrets.ts  leitura dos segredos (só store/payments)
src/server/integrations/{index,errors,viacep,frenet,mercadopago,fakes}.ts   portas externas e falsas
src/server/domain/loyalty/{ledger,appointment-points,prizes,redemptions,settings,ranking}.ts
src/server/domain/banners/banners.ts
src/server/domain/store/{settings,categories,products,addresses,cart,quote-token,shipping,orders,order-events,expiry,checkout,payments}.ts
src/server/domain/vouchers/{partners,vouchers,codes}.ts
src/server/api/schemas/{loyalty,banners,store,vouchers}.ts
src/app/api/v1/{loyalty,banners,store,vouchers}/**, src/app/api/v1/me/{addresses,voucher-codes}/**, src/app/api/v1/webhooks/mercadopago/[webhookKey]/route.ts
src/app/painel/(app)/{fidelidade,banners,loja,vouchers}/**
src/app/painel/(app)/_lib/{modulo.ts,imagem.ts}
src/app/dev/(app)/contas/[id]/integracoes/**
scripts/smoke-pages.ts, prisma/seed*.ts
```

---

### Task 1: Base dos módulos (domínio, API, painel e fumaça)

**Files:**
- Create: `src/server/domain/modules.ts`, `src/app/painel/(app)/_lib/modulo.ts`
- Modify: `src/shared/modules.ts`, `src/server/auth/capabilities.ts`, `src/server/api/define-route.ts` (opção `module`), `src/server/api/openapi.ts`, `src/ui/shells/painel-nav.ts`, `src/server/domain/settings/painel-context.ts` (passa a usar `isModuleOn`), `scripts/smoke-pages.ts`
- Test: `tests/integration/modules.test.ts`, `tests/integration/api/module-route.test.ts`, `tests/unit/capabilities.test.ts`, `tests/unit/painel-nav.test.ts`, `tests/integration/api/openapi.test.ts`

**Interfaces:**
- Produces:

```ts
// src/shared/modules.ts
export const MODULE_NAMES = ['loyalty', 'banners', 'store', 'vouchers'] as const
export type ModuleName = (typeof MODULE_NAMES)[number]
export const MODULE_LABELS: Record<ModuleName, string>   // Fidelidade, Banners, Loja, Vouchers
// src/server/domain/modules.ts
export function isModuleOn(db: Pick<TenantClient | TenantTx, 'businessModules'>, businessId: string, m: ModuleName): Promise<boolean>
export function requireModule(ctx: TenantContext, m: ModuleName, db?: TenantClient | TenantTx): Promise<void>   // DomainError('module_disabled')
// src/app/painel/(app)/_lib/modulo.ts
export function requirePainelModule(ctx: TenantContext, m: ModuleName): Promise<void>   // notFound() se desligado
// define-route.ts: RouteDef ganha `module?: ModuleName`
// capabilities.ts: CAPABILITIES ganha, NO FIM, 'manage_loyalty', 'manage_banners', 'manage_store', 'manage_vouchers'
```

Regras: `requireModule` lê `business_modules` (linha ausente = tudo desligado) e lança `DomainError('module_disabled', 'O módulo <rótulo> não está ligado nesta conta.')`. As capacidades novas entram no fim da lista (as cinco básicas do profissional continuam sendo as cinco primeiras); o gerente recebe todas, o dono e o suporte também; `platform_admin` continua só com `manage_settings`. Na rota com `module`, a conferência acontece depois de montar o contexto (chave, limites e token) e ANTES de validar `params`, `query` e `body`: módulo desligado nunca devolve 422. O OpenAPI acrescenta à descrição da operação "Exige o módulo <rótulo> ligado" e a resposta 404 já existente cita `module_disabled`. `painelNav` acrescenta, depois de Serviços e antes de Relatórios, Fidelidade (`/fidelidade`, ícone `Gift`), Banners (`/banners`, `Images`), Loja (`/loja`, `ShoppingBag`) e Vouchers (`/vouchers`, `Ticket`), cada um só com o módulo ligado E a capacidade. Fumaça: o script passa a abrir também uma sessão de dono da primeira conta do seed com TODOS os módulos ligados e pede a lista `PAGINAS_MODULOS` nela (vazia nesta tarefa, as seguintes acrescentam); e pede `['/fidelidade', '/banners', '/loja', '/vouchers']` como dono de uma conta com a Loja desligada esperando 404 para `/loja` e `/vouchers`.

- [ ] **Step 1: Testes que falham:** `requireModule` com a linha de módulos ausente → `module_disabled`; ligado → passa; conta A com loja ligada e B desligada: `requireModule(ctxB, 'store')` falha; `can(gerente, 'manage_store')` verdadeiro, `can(profissional, 'manage_loyalty')` falso, `can(platform_admin, 'manage_banners')` falso, e as cinco primeiras capacidades seguem iguais; rota de teste com `module: 'banners'` e `body` obrigatório: desligado + corpo inválido → 404 `module_disabled` sem chamar o handler; ligado + corpo inválido → 422; ligado + válido → handler roda; o documento OpenAPI da rota de teste cita o módulo; `painelNav` do dono com Loja ligada e Fidelidade desligada tem "Loja" e não tem "Fidelidade"; do profissional com tudo ligado não tem nenhum dos quatro; teste de manifesto: toda rota cujo caminho começa com `/v1/loyalty`, `/v1/banners`, `/v1/store`, `/v1/vouchers`, `/v1/me/addresses` ou `/v1/me/voucher-codes` declara `module` (passa vazio agora; pega as rotas das próximas tarefas).
- [ ] **Step 2:** Rodar → FALHA (guardar a saída). Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: base dos módulos (capacidades, rotas e páginas por módulo)`.

---

### Task 2: Integrações por conta e segredos cifrados — SENSÍVEL

**Files:**
- Create: `src/server/auth/secret-box.ts`, `src/server/domain/platform/integrations.ts`, `src/server/domain/platform/integration-secrets.ts`, `src/app/dev/(app)/contas/[id]/integracoes/{page.tsx,actions.ts,IntegracoesForms.tsx}`, migração `20261119000000_business_integrations`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts` (`BusinessIntegration` em `PLATFORM_MODELS`), `src/app/dev/(app)/contas/[id]/tabs.ts` (aba "Integrações" depois de "Chaves"), `scripts/smoke-pages.ts` (`/contas/{conta}/integracoes`)
- Test: `tests/unit/secret-box.test.ts`, `tests/integration/platform-integrations.test.ts`, `tests/integration/dev-integrations-actions.test.ts`, `tests/unit/integration-secrets-imports.test.ts`

**Interfaces:**
- Produces:

```ts
// auth/secret-box.ts
export class SecretBoxError extends Error {}
export function sealSecret(plain: string, aad: string): string   // "v1.<iv>.<cifra>.<tag>" em base64url; iv de 12 bytes aleatório
export function openSecret(sealed: string, aad: string): string  // SecretBoxError se adulterado, outra chave ou outro aad
export function lastFour(plain: string): string
// domain/platform/integrations.ts (ator admin, conferido em execução; auditoria na mesma transação)
export type IntegrationsView = {
  version: number
  mercadoPago: { configured: boolean; accessTokenLast4: string | null; webhookSecretLast4: string | null; webhookUrl: string | null; updatedLabel: string | null }
  frenet: { configured: boolean; tokenLast4: string | null; updatedLabel: string | null }
}
export function getIntegrations(actor: PlatformAdminActor, businessId: string): Promise<IntegrationsView>
export function setMercadoPago(actor: PlatformAdminActor, businessId: string, version: number, i: { accessToken?: string; webhookSecret?: string }): Promise<IntegrationsView>
export function clearMercadoPago(actor: PlatformAdminActor, businessId: string, version: number): Promise<IntegrationsView>
export function setFrenet(actor: PlatformAdminActor, businessId: string, version: number, i: { token: string }): Promise<IntegrationsView>
export function clearFrenet(actor: PlatformAdminActor, businessId: string, version: number): Promise<IntegrationsView>
// domain/platform/integration-secrets.ts (sem ator: só para o domínio da loja; teste estático limita quem importa)
export function readMercadoPagoSecrets(businessId: string): Promise<{ accessToken: string; webhookSecret: string } | null>
export function findMercadoPagoByWebhookKey(webhookKey: string): Promise<{ businessId: string; accessToken: string; webhookSecret: string } | null>
export function readFrenetToken(businessId: string): Promise<string | null>
export function integrationStatus(businessId: string): Promise<{ mercadoPago: boolean; frenet: boolean }>
```

Regras: chave da cifra = `hkdfSync('sha256', APP_SECRET, '', 'agendaflui/integration-secrets/v1', 32)`, calculada uma vez; `aad` = `${businessId}:mercadopago:access_token`, `${businessId}:mercadopago:webhook_secret` e `${businessId}:frenet:token`. Formatos aceitos: token do Mercado Pago `^(APP_USR|TEST)-[0-9A-Za-z-]{20,250}$`; segredo do webhook `^[0-9A-Za-z]{16,200}$`; token da Frenet `^[0-9A-Za-z-]{16,200}$` (espaços nas pontas são removidos; mensagem de erro nunca repete o valor). Mercado Pago só fica "configurado" com os dois segredos; o primeiro `setMercadoPago` exige os dois, os seguintes aceitam trocar só um. `mp_webhook_key` = 32 bytes aleatórios em base64url, criado no primeiro `setMercadoPago` e trocado só por `clearMercadoPago` (a URL do webhook muda, o que a tela avisa). `webhookUrl` = `areaLink('api', '/v1/webhooks/mercadopago/<webhookKey>')`. Toda gravação: versão conferida (`conflict`/`stale_version`), auditoria `integration.mercadopago.updated|cleared` e `integration.frenet.updated|cleared` com `metadata: { fields: [...] }` e NENHUM valor nem final. Linha de outra conta com segredo cifrado copiado: `openSecret` falha (aad) e as leituras devolvem `null` e registram só o nome do erro. `integration-secrets.ts` só pode ser importado por `src/server/domain/store/**` e `src/server/domain/platform/**` (teste estático que varre `src/`). Tela (painel dev, tema noite): dois cartões, Mercado Pago e Frenet, com situação por `StatusDot` e texto ("Configurado, termina em 4F2A" / "Não configurado"), campos `type="password"` com `autoComplete="off"` NUNCA preenchidos, "Salvar", "Remover" com confirmação, e a URL do webhook com `CopyButton` e a instrução curta ("No painel do Mercado Pago, em Suas integrações > Webhooks, cole este endereço, marque o evento Pagamentos e copie a assinatura secreta para o campo acima"). A ação nunca devolve o segredo no estado do formulário: o `parse` descarta os campos secretos de `values`.

- [ ] **Step 1: Testes que falham:** `sealSecret`/`openSecret` ida e volta; dois selos do mesmo texto diferem; um byte trocado na cifra, na tag ou no iv → `SecretBoxError`; `aad` de outra conta → `SecretBoxError`; `getIntegrations` de conta sem linha: nada configurado; `setMercadoPago` com só o token na primeira vez → `validation`; com os dois: `configured`, finais certos, `webhookUrl` no host da API, e a linha no banco não contém o texto puro em nenhuma coluna; trocar só o segredo mantém o token e a `webhookKey`; `clearMercadoPago` troca a `webhookKey`; versão antiga → `conflict`; auditoria sem valor nem final (procura o texto e os 4 últimos no JSON); `findMercadoPagoByWebhookKey` com chave desconhecida → `null`; cifra da conta A copiada para a linha de B → `readMercadoPagoSecrets(B)` = `null`; `tenantDb(A).businessIntegration` → `TenantViolationError`; ação de salvar com token inválido devolve erro de campo e `values` sem o token; teste estático de importação.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: integrações por conta com segredos cifrados e aba no painel dev`.

---

### Task 3: Fidelidade — domínio e API (pontos, prêmios, resgates, ranking) — SENSÍVEL

**Files:**
- Create: `src/server/domain/loyalty/{ledger,appointment-points,prizes,redemptions,settings,ranking}.ts`, `src/server/api/schemas/loyalty.ts`, `src/app/api/v1/loyalty/{me,me/statement,prizes,redemptions,redemptions/[id]/cancel,ranking}/route.ts`, migração `20261119010000_loyalty`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `src/server/db/tenant.ts` (escopo `loyalty`), `src/server/domain/scheduling/appointment-view.ts` (`afterChange` chama `applyAppointmentLoyalty` antes dos avisos), `src/server/domain/errors.ts` (`insufficient_points`, `out_of_stock`), `src/server/api/routes-manifest.ts` (a imagem do prêmio usa o propósito `generic`)
- Test: `tests/integration/loyalty-ledger.test.ts`, `tests/integration/loyalty-appointments.test.ts`, `tests/integration/loyalty-redemptions.test.ts`, `tests/integration/loyalty-race.test.ts`, `tests/integration/api/loyalty-routes.test.ts`

**Interfaces:**
- Consumes: `afterChange(tx, ctx, event, row, extra)` e `ChangeEvent`/`ChangeExtra`/`Row` (`appointment-view.ts`), `requireModule`, `writeSettings` (`settings/versioned.ts`), `saveImage`/`deleteUploadRecord`/`removeUploadFile`, `party(ctx)`, `audit`.
- Produces:

```ts
// ledger.ts
export type LoyaltyEntryView = { id: string; kind: LoyaltyEntryKind; points: number; reason: string | null; appointmentId: string | null; redemptionId: string | null; createdAt: Date; createdLabel: string }
export function getBalance(db: TenantClient | TenantTx, customerId: string): Promise<number>
export function getCustomerLoyalty(ctx: TenantContext, customerId: string): Promise<{ balance: number; clubMember: boolean }>
export function listLoyaltyEntries(ctx: TenantContext, customerId: string, q?: { cursor?: string; limit?: number }): Promise<{ items: LoyaltyEntryView[]; nextCursor: string | null }>
export function adjustPoints(ctx: TenantContext, i: { customerId: string; points: number; reason: string }): Promise<{ entry: LoyaltyEntryView; balance: number }>
// appointment-points.ts
export function applyAppointmentLoyalty(tx: TenantTx, ctx: TenantContext, event: ChangeEvent, appointment: Row, extra: ChangeExtra): Promise<void>
// prizes.ts
export type PrizeInput = { name: string; description: string | null; costPoints: number; stock: number | null; active: boolean }
export type PrizeView = PrizeInput & { id: string; imageUrl: string | null; displayOrder: number; archivedAt: Date | null }
export function listPrizes(ctx: TenantContext, q?: { includeInactive?: boolean; includeArchived?: boolean }): Promise<PrizeView[]>
export function getPrize(ctx: TenantContext, id: string): Promise<PrizeView>
export function createPrize(ctx: TenantContext, i: PrizeInput): Promise<PrizeView>
export function updatePrize(ctx: TenantContext, id: string, i: Partial<PrizeInput>): Promise<PrizeView>
export function archivePrize(ctx: TenantContext, id: string): Promise<void>
export function movePrize(ctx: TenantContext, id: string, direction: 'up' | 'down'): Promise<void>
export function setPrizeImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<PrizeView>
// redemptions.ts
export type RedemptionView = { id: string; status: RedemptionStatus; prize: { id: string; name: string }; costPoints: number; customer: { id: string; name: string }; createdLabel: string; deliveredLabel: string | null; canceledLabel: string | null; cancelReason: string | null }
export function redeemPrize(ctx: TenantContext, i: { prizeId: string; customerId?: string; deliverNow?: boolean; idempotencyKey?: string }): Promise<{ redemption: RedemptionView; balance: number; replayed: boolean }>
export function listRedemptions(ctx: TenantContext, q?: { status?: RedemptionStatus; customerId?: string; cursor?: string; limit?: number }): Promise<{ items: RedemptionView[]; nextCursor: string | null }>
export function deliverRedemption(ctx: TenantContext, id: string): Promise<RedemptionView>
export function cancelRedemption(ctx: TenantContext, id: string, i?: { reason?: string | null }): Promise<RedemptionView>
// settings.ts e ranking.ts
export function getLoyaltySettings(ctx: TenantContext): Promise<{ rankingEnabled: boolean; version: number }>
export function updateLoyaltySettings(ctx: TenantContext, version: number, i: { rankingEnabled: boolean }): Promise<{ rankingEnabled: boolean; version: number }>
export function getRanking(ctx: TenantContext): Promise<{ enabled: boolean; month: string; entries: { position: number; firstName: string; avatarUrl: string | null; points: number }[] }>
```

Regras: **Crédito**: no evento `completed`, com Fidelidade ligada, credita `EARN` = soma de `appointment_items.reward_points` (cópia feita na marcação), se > 0, com `dedupe_key = appt:<id>:earn:<n>`, onde `n` = quantidade de `EARN` já gravados para o agendamento; tudo na transação da mudança de situação (que já trava o profissional). **Estorno**: no evento `outcome_undone` vindo de `COMPLETED` (`extra.from`), grava `EARN_REVERSAL` de −(soma líquida de `EARN` + `EARN_REVERSAL` do agendamento), se ≠ 0, com `appt:<id>:reversal:<n>`, mesmo com o módulo desligado; o estorno pode deixar o saldo negativo (o atendimento não aconteceu) e o saldo negativo bloqueia resgates. Desfazer de `NO_SHOW` não mexe em pontos. **Resgate**: cliente (o próprio) ou equipe com `manage_loyalty` (`customerId` obrigatório, `deliverNow` permitido); prêmio ativo, não arquivado; numa transação com `$lockKey('customer', customerId)`: saldo ≥ custo senão `conflict`/`insufficient_points` com a mensagem "Faltam N <pontos>"; estoque por `updateMany` condicional (`stock` nulo não baixa; 0 linhas → `conflict`/`out_of_stock`); grava o resgate (`PENDING`, ou `DELIVERED` com `deliverNow`) e `REDEEM` de −custo com `redemption:<id>`. `Idempotency-Key` igual com o mesmo pedido devolve o resgate original com `replayed: true`; com pedido diferente, `conflict`/`idempotency_key_reused` (mesmo padrão dos agendamentos). **Cancelar resgate**: só `PENDING`; o cliente cancela o próprio, a equipe qualquer um; devolve `REDEEM_REVERSAL` (`redemption:<id>:reversal`) e o estoque. **Entregar**: só `PENDING` → `DELIVERED`. **Ajuste**: `manage_loyalty`, inteiro entre −100.000 e 100.000, ≠ 0, motivo de 3 a 200 caracteres, sob a trava do cliente; ajuste que deixaria o saldo negativo → `conflict`/`insufficient_points`; auditoria `loyalty.adjusted` com pontos e motivo. Cliente arquivado ou anonimizado não resgata nem recebe ajuste (`customer_inactive`). **Ranking**: só com `loyalty_ranking_enabled`; pontos ganhos (`EARN` + `EARN_REVERSAL`) no mês local corrente da conta, 10 primeiros com pontos > 0, sem arquivados nem anonimizados, só o primeiro nome e a foto; desligado → `{ enabled: false, entries: [] }`. Leitura de saldo e extrato: o próprio cliente, ou equipe com `view_clients`. API (todas com `module: 'loyalty'`): `GET /v1/loyalty/me` (cliente: saldo, clube, rótulos dos termos), `GET /v1/loyalty/me/statement` (cursor), `GET /v1/loyalty/prizes` (`key_or_customer`: ativos com estoque ≠ 0; `stock` exposto só como `available: boolean`), `POST /v1/loyalty/redemptions` (cliente, `Idempotency-Key`, limite 10/min por pessoa; 201 ou 200 na repetição), `GET /v1/loyalty/redemptions` (cliente, os próprios), `POST /v1/loyalty/redemptions/{id}/cancel` (cliente), `GET /v1/loyalty/ranking` (`key_or_customer`).

- [ ] **Step 1: Testes que falham:** concluir atendimento com dois serviços de 10 e 15 pontos credita 25 uma vez; concluir → desfazer → concluir: extrato `+25, −25, +25`, saldo 25; desfazer uma falta não grava nada; Fidelidade desligada: concluir não credita, e desfazer uma conclusão creditada antes de desligar estorna; serviço com 0 pontos não grava linha; inserir à mão uma segunda linha com a mesma `dedupe_key` → violação de unicidade; resgate com saldo exato zera o saldo; com saldo menor → `insufficient_points` e nada gravado; dois resgates simultâneos de 100 com saldo 150 → um passa, saldo 50; estoque 1 e dois clientes ao mesmo tempo → um `out_of_stock`; mesma `Idempotency-Key` duas vezes → um resgate e `replayed`; cancelar devolve pontos e estoque, e cancelar de novo → `invalid_transition`; ajuste −30 com saldo 20 → recusado; ajuste sem motivo → `validation`; profissional ajustando → `forbidden`; ranking desligado → `enabled: false`; ligado: só primeiro nome, sem anonimizados, só o mês local de Manaus (crédito às 23:30 do último dia do mês anterior fica fora); cliente da conta B pedindo prêmio de A → `not_found`; rotas com o módulo desligado → 404 `module_disabled`; `POST /v1/loyalty/redemptions` sem saldo → 409 `insufficient_points`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde (com o teste de concorrência rodado 3 vezes seguidas).
- [ ] **Step 3:** Commit: `feat: fidelidade (pontos na conclusão, prêmios, resgates, ajustes e ranking) no domínio e na API`.

---

### Task 4: Banners completo e telas da Fidelidade

**Files:**
- Create: `src/server/domain/banners/banners.ts`, `src/server/api/schemas/banners.ts`, `src/app/api/v1/banners/route.ts`, `src/app/painel/(app)/banners/**` (lista, `novo`, `[id]`, `[id]/imagem/route.ts`), `src/app/painel/(app)/fidelidade/**` (abas Prêmios, Resgates, Clube, Ajustes da conta; `premios/novo`, `premios/[id]`, `premios/[id]/imagem/route.ts`), `src/app/painel/(app)/_lib/imagem.ts`, migração `20261119020000_banners`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `src/server/db/tenant.ts` (escopo `banners`), `src/server/storage/images.ts` (propósito `banner`: caixa 1920×1080, sem recorte, lado menor mínimo 400), `src/app/painel/(app)/clientes/[id]/page.tsx` (seção de pontos), `src/server/api/routes-manifest.ts`, `scripts/smoke-pages.ts`
- Test: `tests/integration/banners.test.ts`, `tests/integration/api/banners-route.test.ts`, `tests/integration/painel-banners-actions.test.ts`, `tests/integration/painel-loyalty-actions.test.ts`, `tests/integration/painel-image-routes.test.ts`

**Interfaces:**
- Consumes: Tarefa 3 inteira, `requirePainelModule`, `tenantAction`, `listCustomers({ clubOnly: true })`, padrão das rotas de envio de imagem (`src/app/_lib/upload-multipart.ts`, `equipe/[id]/foto/route.ts`).
- Produces:

```ts
// banners.ts
export type BannerInput = { title: string; linkUrl: string | null; startsOn: string | null; endsOn: string | null; active: boolean }
export type BannerView = BannerInput & { id: string; imageUrl: string | null; displayOrder: number; showingToday: boolean }
export const bannerLinkSchema: z.ZodType<string | null>
export function listBanners(ctx: TenantContext): Promise<BannerView[]>
export function getBanner(ctx: TenantContext, id: string): Promise<BannerView>
export function listLiveBanners(ctx: TenantContext): Promise<{ id: string; title: string; imageUrl: string; linkUrl: string | null }[]>
export function createBanner(ctx: TenantContext, i: BannerInput): Promise<BannerView>
export function updateBanner(ctx: TenantContext, id: string, i: Partial<BannerInput>): Promise<BannerView>
export function setBannerImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<BannerView>
export function moveBanner(ctx: TenantContext, id: string, direction: 'up' | 'down'): Promise<void>
export function deleteBanner(ctx: TenantContext, id: string): Promise<void>
// _lib/imagem.ts (cada route.ts chama requireTenant antes e entrega o ctx)
export function receberImagem(ctx: TenantContext, request: Request, o: { volta: (codigo: string) => string; salvar: (file: { bytes: Uint8Array } | null) => Promise<unknown> }): Promise<Response>
```

Regras: **Link**: vazio, `https://` ou `http://` com host (até 500 caracteres), ou rota interna do app que casa com `^/[a-z0-9][a-z0-9/_-]*$` (sem `//`, sem `..`); qualquer outro esquema (`javascript:`, `data:`, `mailto:`) → erro de campo "Use um endereço que comece com https:// ou uma rota do app, como /servicos". **Período**: datas locais da conta, inclusive; `endsOn` < `startsOn` → erro no campo `endsOn`. Banner nasce inativo e sem imagem; só fica ativo com imagem (domínio e CHECK). `listLiveBanners`: ativos, com imagem, `todayIn(ctx.timeZone, ctx.clock())` dentro do período, em ordem; no máximo 20. Banner não tem histórico: excluir apaga a linha e a imagem (com confirmação na tela). Tudo com `manage_banners` e o módulo ligado, menos `listLiveBanners` (qualquer ator da conta, módulo ligado). API: `GET /v1/banners` (`key`, `module: 'banners'`). **Telas Banners**: lista com miniatura, título, período em texto ("De 01/12 a 24/12", "Sem fim"), selo "No ar hoje"/"Agendado"/"Encerrado"/"Inativo", subir/descer, ativar; formulário com título, link, período e envio de imagem (rota multipart), prévia 16:9. **Telas Fidelidade** (`manage_loyalty`): abas por `NavTabs` com `?aba=`: Prêmios (lista ordenável, custo em termos da conta, estoque "Sem limite" ou número, arquivar; formulário com imagem), Resgates (filtro por situação na URL, paginado; entregar e cancelar com motivo), Clube (lista dos membros do clube com link para a ficha; a marcação de membro continua na ficha do cliente) e Ajustes da conta (o interruptor do ranking, com versão e o aviso "Mostra no app o primeiro nome e a foto dos 10 que mais ganharam <pontos> no mês"). **Ficha do cliente**, com Fidelidade ligada: saldo (`StatNumber`), extrato paginado e, para `manage_loyalty`, "Ajustar <pontos>" (folha com valor com sinal e motivo) e "Resgatar no balcão" (prêmio + entregar agora); o profissional vê saldo e extrato, sem botões. `receberImagem` repete o comportamento da rota de foto da equipe (origem do mesmo host, teto de corpo, `intent=remove`, volta com `?imagem=<código>`).

- [ ] **Step 1: Testes que falham:** `bannerLinkSchema` aceita `https://loja.exemplo/x`, `/servicos`, vazio, e recusa `javascript:alert(1)`, `data:text/html,x`, `//evil.example`, `/a/../b`, `ftp://x`; ativar sem imagem → `validation`; `listLiveBanners` em Manaus às 23:30 do dia 24 inclui o banner que termina em 24 e às 00:30 do dia 25 não; banner inativo e banner sem imagem não aparecem; dois `moveBanner` simultâneos terminam sem ordem repetida; excluir remove o arquivo; banner da conta B por id em A → `not_found`; rota com módulo desligado → 404 `module_disabled`; ações chamadas direto: profissional criando banner ou prêmio → "sem permissão"; criar prêmio com custo 0 → erro no campo; cancelar resgate pela tela devolve os pontos; ajuste pela tela grava motivo e o saldo da ficha muda; ligar o ranking com versão antiga → conflito com o digitado; rota de imagem sem sessão → redireciona sem gravar e com outra origem → 403; páginas `/banners` e `/fidelidade` com o módulo desligado → 404 (chamando a página direto).
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes (`/banners`, `/banners/novo`, `/banners/{banner}`, `/fidelidade`, `/fidelidade?aba=resgates`, `/fidelidade?aba=clube`, `/fidelidade?aba=ajustes`, `/fidelidade/premios/novo` em `PAGINAS_MODULOS`).
- [ ] **Step 3:** Commit: `feat: banners (domínio, API e telas) e telas da fidelidade`.

---

### Task 5: Loja — catálogo, endereços e configurações

**Files:**
- Create: `src/server/domain/store/{settings,categories,products,addresses}.ts`, `src/server/integrations/{index,errors,viacep,fakes}.ts`, `src/server/api/schemas/store.ts`, `src/app/api/v1/store/{options,categories,products,products/[id],postal-codes/[cep]}/route.ts`, `src/app/api/v1/me/addresses/{route.ts,[id]/route.ts}`, `src/app/painel/(app)/loja/**` (abas Produtos, Categorias, Configurações; `produtos/novo`, `produtos/[id]`, `produtos/[id]/imagens/route.ts`), migração `20261119030000_store_catalog`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `src/server/db/tenant.ts` (escopo `store`), `src/server/env.ts` (`INTEGRATIONS_MODE`), `src/server/domain/customers/customers.ts` (`anonymizeCustomer` apaga os endereços), `src/server/api/routes-manifest.ts`, `scripts/smoke-pages.ts`
- Test: `tests/integration/store-catalog.test.ts`, `tests/integration/store-addresses.test.ts`, `tests/unit/viacep.test.ts`, `tests/unit/env.test.ts`, `tests/integration/api/store-catalog-routes.test.ts`, `tests/integration/painel-store-catalog-actions.test.ts`

**Interfaces:**
- Consumes: `requireModule`, `integrationStatus` (Tarefa 2), `receberImagem` (Tarefa 4), `saveImage` (`generic`).
- Produces:

```ts
// integrations/errors.ts e index.ts
export class IntegrationError extends Error { constructor(public code: 'timeout' | 'unavailable' | 'rejected' | 'invalid_response', message: string) }
export interface PostalCodeGateway { lookup(cep: string): Promise<{ street: string; district: string; city: string; state: string } | null> }
export type Integrations = { postalCodes: PostalCodeGateway }   // as Tarefas 6 e 7 acrescentam frenet e mercadoPago
export function integrations(): Integrations
export function setIntegrationsForTests(i: Partial<Integrations> | null): void
// store/settings.ts
export type StoreSettings = { pickupEnabled: boolean; pickupInstructions: string | null; shippingEnabled: boolean; originPostalCode: string | null; defaultPackage: { weightGrams: number; lengthCm: number; heightCm: number; widthCm: number }; paymentWindowMin: number; version: number }
export function getStoreSettings(ctx: TenantContext, db?: TenantClient | TenantTx): Promise<StoreSettings>
export function updateStoreSettings(ctx: TenantContext, version: number, i: Omit<StoreSettings, 'version'>): Promise<StoreSettings>
export function getStoreOptions(ctx: TenantContext): Promise<{ pickup: { enabled: boolean; instructions: string | null }; shipping: { enabled: boolean }; payment: { available: boolean } }>
// store/categories.ts
export type CategoryView = { id: string; name: string; displayOrder: number; productCount: number; archivedAt: Date | null }
export function listCategories(ctx: TenantContext, q?: { includeArchived?: boolean }): Promise<CategoryView[]>
export function createCategory(ctx: TenantContext, i: { name: string }): Promise<CategoryView>
export function renameCategory(ctx: TenantContext, id: string, i: { name: string }): Promise<CategoryView>
export function archiveCategory(ctx: TenantContext, id: string): Promise<void>
export function moveCategory(ctx: TenantContext, id: string, direction: 'up' | 'down'): Promise<void>
// store/products.ts
export type ProductInput = { categoryId: string | null; name: string; description: string | null; priceCents: number; promoPriceCents: number | null; stock: number; weightGrams: number | null; lengthCm: number | null; heightCm: number | null; widthCm: number | null; active: boolean }
export type ProductView = ProductInput & { id: string; finalPriceCents: number; images: { id: string; url: string }[]; displayOrder: number; archivedAt: Date | null }
export type PublicProduct = { id: string; categoryId: string | null; name: string; description: string | null; priceCents: number; promoPriceCents: number | null; finalPriceCents: number; available: boolean; maxQuantity: number; images: { url: string }[] }
export function listProducts(ctx: TenantContext, q?: { categoryId?: string; search?: string; situation?: 'active' | 'inactive' | 'archived'; cursor?: string; limit?: number }): Promise<{ items: ProductView[]; nextCursor: string | null }>
export function listPublicProducts(ctx: TenantContext, q?: { categoryId?: string; search?: string; cursor?: string; limit?: number }): Promise<{ items: PublicProduct[]; nextCursor: string | null }>
export function getProduct(ctx: TenantContext, id: string): Promise<ProductView>
export function getPublicProduct(ctx: TenantContext, id: string): Promise<PublicProduct>
export function createProduct(ctx: TenantContext, i: ProductInput): Promise<ProductView>
export function updateProduct(ctx: TenantContext, id: string, i: Partial<ProductInput>): Promise<ProductView>
export function adjustStock(ctx: TenantContext, id: string, delta: number, reason: string): Promise<ProductView>
export function archiveProduct(ctx: TenantContext, id: string): Promise<void>
export function addProductImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array }): Promise<ProductView>
export function removeProductImage(ctx: TenantContext, id: string, imageId: string): Promise<ProductView>
export function moveProductImage(ctx: TenantContext, id: string, imageId: string, direction: 'up' | 'down'): Promise<ProductView>
// store/addresses.ts (cliente: os próprios)
export type AddressInput = { label: string | null; recipientName: string; postalCode: string; street: string; number: string; complement: string | null; district: string; city: string; state: string; isDefault: boolean }
export type AddressView = AddressInput & { id: string }
export function listAddresses(ctx: TenantContext): Promise<AddressView[]>
export function createAddress(ctx: TenantContext, i: AddressInput): Promise<AddressView>
export function updateAddress(ctx: TenantContext, id: string, i: Partial<AddressInput>): Promise<AddressView>
export function deleteAddress(ctx: TenantContext, id: string): Promise<void>
export function lookupPostalCode(ctx: TenantContext, cep: string): Promise<{ address: { postalCode: string; street: string; district: string; city: string; state: string } | null; unavailable: boolean }>
```

Regras: `INTEGRATIONS_MODE`: `real` ou `fake`; fora de produção o padrão é `fake`; em produção o padrão é `real` e `fake` é erro de partida. A ViaCEP real chama `https://viacep.com.br/ws/<cep>/json/` com tempo limite de 5 s; `{"erro": true}` → `null`; falha de rede, tempo esgotado ou resposta fora do formato → `IntegrationError`. A falsa devolve um endereço fixo para qualquer CEP de 8 dígitos e `null` para `00000000`. CEP: só dígitos depois de tirar `-` e espaços; 8 dígitos senão `validation`. `lookupPostalCode` nunca falha por causa da ViaCEP: indisponível → `{ address: null, unavailable: true }` (a tela deixa digitar). Endereço: UF entre as 27 siglas, `recipientName` 2–80, número 1–10, até 10 por cliente, um padrão só (marcar outro desmarca o anterior na mesma transação), só o próprio cliente lê e altera. Produto: preço > 0, promoção > 0 e < preço, estoque 0–100.000, dimensões opcionais (peso 1–30.000 g, lados 1–200 cm) que, se ausentes, vêm do pacote padrão das configurações; até 6 imagens; `finalPriceCents` = promoção ou preço; `maxQuantity` = mínimo entre estoque e 99; produto inativo, arquivado ou de categoria arquivada não aparece ao app (`getPublicProduct` → `not_found`). `adjustStock` (entrada ou acerto manual) audita com o motivo e não deixa o estoque negativo. Configurações: retirada e entrega não podem estar as duas desligadas; ligar a entrega exige CEP de origem; versão conferida. `getStoreOptions.payment.available` = Mercado Pago configurado (`integrationStatus`). Anonimizar cliente apaga os endereços dele. API (todas `module: 'store'`): `GET /v1/store/options` (`key`), `GET /v1/store/categories` (`key`), `GET /v1/store/products` (`key`; `categoryId`, `search`, `cursor`), `GET /v1/store/products/{id}` (`key`), `GET /v1/store/postal-codes/{cep}` (cliente; limite 30/min por pessoa), `GET|POST /v1/me/addresses` e `PATCH|DELETE /v1/me/addresses/{id}` (cliente). Telas (`manage_store`): `/loja?aba=produtos` (lista paginada com busca, filtro por categoria e situação, miniatura, preço final, estoque com aviso "Acabou" em texto), formulário de produto (dinheiro por `MoneyField`, promoção opcional, estoque, categoria, dimensões recolhidas em "Entrega", imagens com subir/descer/remover), "Ajustar estoque" (folha com quantidade com sinal e motivo); `?aba=categorias` (lista ordenável, renomear, arquivar); `?aba=configuracoes` (retirada e instruções, entrega com CEP de origem e pacote padrão, prazo para pagar em minutos, e a situação das integrações em texto: "Pagamento pelo Mercado Pago: configurado" ou "não configurado: peça ao suporte do AgendaFlui").

- [ ] **Step 1: Testes que falham:** `INTEGRATIONS_MODE=fake` com `NODE_ENV=production` → erro de ambiente; sem a variável, produção resolve `real` e teste `fake`; ViaCEP real com `fetch` falso: `{"erro": true}` → `null`, 500 → `IntegrationError('unavailable')`, demora → `timeout` (relógio falso do Vitest); `lookupPostalCode` com a ViaCEP falhando → `unavailable: true`; CEP `1234-567` → `validation`; produto com promoção ≥ preço → erro no campo `promoPriceCents`; produto inativo fora da lista pública e `getPublicProduct` → `not_found`; produto da conta B por id em A → `not_found`; `maxQuantity` com estoque 150 é 99; `adjustStock(-5)` com estoque 3 → recusado; sétima imagem → recusada; categoria com nome repetido (sem acento e caixa diferentes contam como iguais) → `conflict`; endereço com UF `XX` → erro no campo; décimo primeiro endereço → recusado; marcar um novo padrão desmarca o anterior; cliente A lendo endereço de B (mesma conta) → `not_found`; anonimizar apaga os endereços; desligar retirada e entrega juntas → `validation`; entrega ligada sem CEP de origem → erro no campo; rotas com Loja desligada → 404 `module_disabled`; ações da tela: profissional criando produto → "sem permissão", preço "19,90" grava 1990.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes (`/loja`, `/loja?aba=produtos&search=a`, `/loja?aba=categorias`, `/loja?aba=configuracoes`, `/loja/produtos/novo`, `/loja/produtos/{produto}`).
- [ ] **Step 3:** Commit: `feat: loja (catálogo, endereços com CEP e configurações) no domínio, na API e no painel`.

---

### Task 6: Loja — frete e pedidos — SENSÍVEL

**Files:**
- Create: `src/server/domain/store/{cart,quote-token,shipping,orders,order-events,expiry}.ts`, `src/server/integrations/frenet.ts`, `src/app/api/v1/store/{shipping-quotes,orders,orders/[id],orders/[id]/cancel}/route.ts`, migração `20261119040000_store_orders`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `src/server/db/tenant.ts` (escopo `order`), `src/server/integrations/{index,fakes}.ts` (Frenet), `src/server/auth/context.ts` (`createSystemContext`), `src/server/domain/errors.ts` (`out_of_stock` já existe; `invalid_quote`, `quote_expired`, `shipping_unavailable`, `pickup_unavailable`), `src/server/domain/customers/customers.ts` (anonimizar limpa `ship_*` e `customer_note` dos pedidos), `src/server/api/schemas/store.ts`, `src/server/api/routes-manifest.ts`
- Test: `tests/unit/quote-token.test.ts`, `tests/unit/frenet.test.ts`, `tests/integration/store-cart.test.ts`, `tests/integration/store-orders.test.ts`, `tests/integration/store-orders-race.test.ts`, `tests/integration/store-expiry.test.ts`, `tests/integration/api/store-order-routes.test.ts`

**Interfaces:**
- Consumes: Tarefa 5 (produtos, endereços, configurações, `integrations()`), `readFrenetToken` (Tarefa 2), `requireModule`, `party(ctx)`, padrão de idempotência dos agendamentos (`idempotencyKey` + hash do pedido).
- Produces:

```ts
// integrations/frenet.ts
export interface FrenetGateway { quote(token: string, q: { sellerCep: string; recipientCep: string; invoiceValueCents: number; items: { sku: string; quantity: number; weightKg: number; lengthCm: number; heightCm: number; widthCm: number }[] }): Promise<{ serviceCode: string; name: string; carrier: string; priceCents: number; days: number }[]> }
// store/cart.ts
export type CartLine = { productId: string; quantity: number }   // a Tarefa 9 acrescenta { voucherId: string; quantity: number }
export type PricedCart = { lines: { kind: 'product'; id: string; name: string; unitPriceCents: number; quantity: number; totalCents: number; weightGrams: number; lengthCm: number; heightCm: number; widthCm: number }[]; itemsCents: number; physical: boolean; hash: string }
export function priceCart(ctx: TenantContext, lines: CartLine[], db?: TenantClient | TenantTx): Promise<PricedCart>
// store/quote-token.ts
export type QuotePayload = { businessId: string; customerId: string; addressId: string; postalCode: string; cartHash: string; serviceCode: string; serviceName: string; priceCents: number; days: number; expiresAtMs: number }
export function signQuote(p: QuotePayload): string
export function readQuote(token: string): QuotePayload | null   // assinatura conferida em tempo constante
// store/shipping.ts
export type ShippingQuote = { pickup: { available: boolean; instructions: string | null }; options: { serviceCode: string; name: string; carrier: string; priceCents: number; days: number; quoteToken: string }[]; shippingError: string | null }
export function quoteShipping(ctx: TenantContext, i: { addressId: string; lines: CartLine[] }): Promise<ShippingQuote>
// store/orders.ts (OrderStatus, FulfillmentStatus e DeliveryMethod são os enums gerados pelo Prisma)
export type OrderAttention = 'amount_mismatch' | 'stock_shortfall' | 'payment_reversed'
export type Delivery = { method: 'PICKUP' } | { method: 'SHIPPING'; addressId: string; quoteToken: string } | { method: 'NONE' }
export type OrderView = { id: string; number: number; status: OrderStatus; fulfillmentStatus: FulfillmentStatus; deliveryMethod: DeliveryMethod; items: { kind: 'product' | 'voucher'; id: string; name: string; unitPriceCents: number; quantity: number; totalCents: number }[]; itemsCents: number; shippingCents: number; totalCents: number; shipping: { serviceName: string; days: number; trackingCode: string | null } | null; address: Omit<AddressInput, 'label' | 'isDefault'> | null; pickupInstructions: string | null; customer: { id: string; name: string }; customerNote: string | null; createdLabel: string; expiresAt: Date; expiresLabel: string; paidLabel: string | null; canceledLabel: string | null; cancelReason: string | null; attention: OrderAttention | null; canCancel: boolean; canPay: boolean }
export function createOrder(ctx: TenantContext, i: { lines: CartLine[]; delivery: Delivery; note: string | null; idempotencyKey?: string }): Promise<{ order: OrderView; replayed: boolean }>
export function listOrders(ctx: TenantContext, q?: { status?: OrderStatus | 'to_fulfill'; search?: string; customerId?: string; cursor?: string; limit?: number }): Promise<{ items: OrderView[]; nextCursor: string | null }>
export function getOrder(ctx: TenantContext, id: string): Promise<OrderView>
export function cancelOrder(ctx: TenantContext, id: string, i?: { reason?: string | null }): Promise<OrderView>
export function advanceFulfillment(ctx: TenantContext, id: string, i: { to: FulfillmentStatus; trackingCode?: string | null }): Promise<OrderView>
// store/order-events.ts (ponto único dos efeitos de fechar um pedido; a Tarefa 7 acrescenta orderPaid e a 9 os códigos)
export function orderVoided(tx: TenantTx, ctx: TenantContext, orderId: string, how: 'canceled' | 'expired' | 'refunded'): Promise<void>
// store/expiry.ts
export function expireOverdueOrders(ctx: TenantContext): Promise<number>
// auth/context.ts
export function createSystemContext(businessId: string, clock?: () => Date): Promise<TenantContext>   // aceita conta suspensa ou arquivada (pagamento já feito não espera reativação)
```

Regras: **Carrinho**: 1–20 linhas, sem produto repetido, quantidade 1–99; cada produto ativo, não arquivado, de categoria não arquivada; preço = `finalPriceCents` LIDO DO BANCO; `hash` = SHA-256 do carrinho normalizado (linhas ordenadas por id, `id:quantidade`). **Cotação**: endereço do próprio cliente; CEP de origem e token da Frenet configurados, senão `shippingError` "A entrega não está disponível agora. Você pode retirar no local." (nunca erro HTTP); `invoiceValueCents` = itens; itens com as dimensões do produto ou do pacote padrão; a Frenet real faz `POST https://api.frenet.com.br/shipping/quote` com o cabeçalho `token`, tempo limite de 8 s, ignora serviços com `Error: true`, converte `ShippingPrice` (texto com ponto decimal) em centavos por texto, sem `parseFloat` em dinheiro; falha, tempo esgotado ou lista vazia → `options: []` e `shippingError`; a falsa devolve PAC (R$ 21,50, 7 dias) e SEDEX (R$ 38,90, 3 dias). Cada opção leva `quoteToken` = HMAC-SHA256 (chave HKDF `agendaflui/shipping-quote/v1`) do payload, válido por 30 minutos. **Criar pedido** (cliente, só o próprio): módulo ligado; reprecifica o carrinho; `PICKUP` exige retirada ligada (`pickup_unavailable`); `SHIPPING` exige `readQuote` válido com mesma conta, mesmo cliente, mesmo endereço, CEP do endereço inalterado e mesmo `cartHash` (senão `invalid_quote`), não vencido (`quote_expired`), e o frete é o `priceCents` do token; `NONE` só para carrinho sem item físico (nesta tarefa, sempre recusado: todo produto é físico). Numa transação: `$lockKey('store', businessId)` para o `number` (máximo + 1, começando em 1001); reserva de estoque por `updateMany` condicional em cada linha (falhou uma → `conflict`/`out_of_stock` com o nome do produto e nada gravado); grava pedido (`AWAITING_PAYMENT`, `expires_at` = agora + `payment_window_min`), itens com nome e preço copiados e a cópia do endereço; `Idempotency-Key` como nos agendamentos. **Cancelar**: o cliente só o próprio e só `AWAITING_PAYMENT`; a equipe (`manage_store`) também `PAID` (a tela avisa que o estorno é feito no Mercado Pago); sob `$lockKey('order', id)`; chama `orderVoided`, que devolve o estoque uma vez só (`stock_released_at` nulo → devolve e grava; já gravado → nada) e, para pedido pago, só se a entrega ainda for `PENDING`. **Entrega** (`manage_store`, só `PAID`): `PICKUP`: `PENDING → READY_FOR_PICKUP → DELIVERED`; `SHIPPING`: `PENDING → SHIPPED` (código de rastreio opcional, até 40) `→ DELIVERED`; voltar um passo é permitido (engano); outra transição → `invalid_transition`. **Vencimento**: `expireOverdueOrders` passa `AWAITING_PAYMENT` com `expires_at` ≤ agora a `EXPIRED`, um por vez sob a trava do pedido, chamando `orderVoided`; roda com a Loja desligada. Leitura: o cliente lê os próprios; a equipe com `manage_store` lê todos. API (`module: 'store'`, cliente): `POST /v1/store/shipping-quotes` (limite 20/min por pessoa), `POST /v1/store/orders` (`Idempotency-Key`, limite 10/min por pessoa, 201 ou 200 na repetição), `GET /v1/store/orders`, `GET /v1/store/orders/{id}`, `POST /v1/store/orders/{id}/cancel`. O corpo de `POST /v1/store/orders` é estrito: `priceCents`, `totalCents` ou `shippingCents` enviados pelo app são campo desconhecido (422).

- [ ] **Step 1: Testes que falham:** `readQuote` recusa token com um caractere trocado, com outra chave e vencido; cotação com a Frenet falhando devolve `shippingError` e retirada disponível; a Frenet real com `fetch` falso converte `"21.5"` em 2150 e ignora serviço com erro; pedido com retirada: total = soma dos preços do banco (o preço do produto muda depois e o pedido guarda o antigo); `quoteToken` de outro carrinho, de outro endereço, de outro cliente, de outra conta e com o CEP do endereço alterado depois → `invalid_quote`; token vencido (31 min) → `quote_expired`; entrega com o token certo: `total_cents = itens + frete do token`; corpo com `totalCents` → 422; estoque 2 e dois pedidos simultâneos de 2 → um `out_of_stock`, estoque 0; mesma `Idempotency-Key` → um pedido; números sequenciais sem repetição com 10 pedidos simultâneos; cliente cancela pedido aguardando pagamento → estoque volta uma vez (cancelar de novo → `invalid_transition`, estoque igual); cliente cancelando pedido pago → `invalid_transition`; equipe cancela pago com entrega `PENDING` → estoque volta, com `SHIPPED` → não volta; `expireOverdueOrders` com pedido vencido e outro ainda no prazo vence só o primeiro e devolve o estoque, e rodar de novo não devolve outra vez; vencimento com a Loja desligada ainda vence; cliente lendo pedido de outro cliente → `not_found`; pedido da conta B por id em A → `not_found`; anonimizar o cliente limpa o endereço copiado do pedido; rotas com a Loja desligada → 404 `module_disabled`; `createSystemContext` aceita conta suspensa.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde (testes de concorrência 3 vezes seguidas).
- [ ] **Step 3:** Commit: `feat: loja (frete pela Frenet com cotação assinada, pedidos com reserva de estoque e vencimento)`.

---

### Task 7: Loja — pagamento pelo Mercado Pago e webhook — SENSÍVEL

**Files:**
- Create: `src/server/integrations/mercadopago.ts`, `src/server/domain/store/{checkout,payments}.ts`, `src/server/domain/platform/store-sweep.ts`, `src/app/api/v1/store/orders/[id]/checkout/route.ts`, `src/app/api/v1/webhooks/mercadopago/[webhookKey]/route.ts`, migração `20261119050000_payments` (tabela `payments` e o CHECK de `scheduler_runs.kind` com `store`)
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `src/server/integrations/{index,fakes}.ts`, `src/server/domain/store/order-events.ts` (`orderPaid`), `src/server/notifications/{scheduler,scheduler-runs}.ts` (tipo `store` a cada rodada de 1 minuto), `src/server/domain/errors.ts` (`payment_unavailable`), `src/server/auth/rate-limit-db.ts` (`webhookIp: 120/60 s`), `src/server/api/routes-manifest.ts`, `tests/integration/api/openapi.test.ts` (exceção declarada do webhook)
- Test: `tests/unit/mercadopago.test.ts`, `tests/integration/store-checkout.test.ts`, `tests/integration/store-payments.test.ts`, `tests/integration/store-payments-race.test.ts`, `tests/integration/mercadopago-webhook-route.test.ts`, `tests/integration/store-sweep.test.ts`

**Interfaces:**
- Consumes: Tarefa 6 (pedidos, `orderVoided`, `createSystemContext`), `readMercadoPagoSecrets`/`findMercadoPagoByWebhookKey` (Tarefa 2), `areaLink`, `hitRateLimit`.
- Produces:

```ts
// integrations/mercadopago.ts
export type MpPaymentStatus = 'pending' | 'approved' | 'authorized' | 'in_process' | 'in_mediation' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back'
export type MpPayment = { id: string; status: MpPaymentStatus; statusDetail: string | null; amountCents: number; currency: string; externalReference: string | null; approvedAt: Date | null }
export interface MercadoPagoGateway {
  createPreference(accessToken: string, p: { orderId: string; items: { id: string; title: string; quantity: number; unitPriceCents: number }[]; payerEmail: string | null; notificationUrl: string; backUrl: string | null; expiresAt: Date }): Promise<{ preferenceId: string; checkoutUrl: string }>
  getPayment(accessToken: string, paymentId: string): Promise<MpPayment>
  searchPaymentsByReference(accessToken: string, orderId: string): Promise<MpPayment[]>
}
export function verifyMercadoPagoSignature(i: { secret: string; xSignature: string | null; xRequestId: string | null; dataId: string }): boolean
// store/checkout.ts
export function startCheckout(ctx: TenantContext, orderId: string, i?: { returnUrl?: string | null }): Promise<{ checkoutUrl: string; expiresAt: Date; expiresLabel: string }>
// store/payments.ts
export function applyPayment(ctx: TenantContext, orderId: string, payment: MpPayment): Promise<{ orderStatus: OrderStatus; changed: boolean }>
export function handleMercadoPagoNotification(i: { webhookKey: string; dataId: string | null; type: string | null; xSignature: string | null; xRequestId: string | null }): Promise<{ status: 200 | 401 | 404 | 503 }>
export function syncOrderPayments(ctx: TenantContext, orderId: string): Promise<boolean>   // consulta por external_reference; usado pela varredura
// store/order-events.ts
export function orderPaid(tx: TenantTx, ctx: TenantContext, orderId: string): Promise<void>
// platform/store-sweep.ts
export function sweepStore(now: Date): Promise<{ synced: number; expired: number }>
```

Regras: **Mercado Pago real**: `POST https://api.mercadopago.com/checkout/preferences` e `GET https://api.mercadopago.com/v1/payments/{id}` e `GET .../v1/payments/search?external_reference=<orderId>`, com `Authorization: Bearer <token>`, tempo limite 10 s, `X-Idempotency-Key` = id do pedido na criação da preferência; valores em reais convertidos de centavos por texto (`1990` → `19.90`) e de volta por texto (nunca `Math.round(x * 100)` sobre ponto flutuante sem conferir); `currency_id: 'BRL'`; `external_reference` = id do pedido; `expires: true`, `expiration_date_to` = `date_of_expiration` = `expires_at`; boleto excluído (`payment_methods.excluded_payment_types: [{ id: 'ticket' }]`); `back_urls` (sucesso, pendente, falha) e `auto_return: 'approved'` só quando `backUrl` existe. **Assinatura**: `x-signature` = `ts=<ts>,v1=<hex>`; manifesto `id:<dataId em minúsculas>;request-id:<x-request-id>;ts:<ts>;`; HMAC-SHA256 com o segredo do webhook; comparação em tempo constante; sem `x-request-id`, o trecho `request-id` sai do manifesto; qualquer parte faltando ou malformada → `false`; sem janela de tempo (a repetição é inofensiva porque o estado vem da consulta). **Checkout** (cliente, só o próprio, `AWAITING_PAYMENT`, não vencido): Mercado Pago não configurado → `conflict`/`payment_unavailable` "O pagamento pela loja não está disponível agora. Fale com o estabelecimento."; itens da preferência = itens do pedido + "Frete" quando houver, e a soma é conferida contra `total_cents` antes de enviar; reaproveita `mp_preference_id`/`checkout_url` se já existem; `returnUrl` só é aceito se a origem estiver em `allowedOrigins` da chave do app que chamou (senão `validation`); `notificationUrl` = URL do webhook da conta. Falha do Mercado Pago → `conflict`/`payment_unavailable` sem mudar o pedido. **Webhook** (`POST /v1/webhooks/mercadopago/{webhookKey}`, rota simples sem `defineRoute`, sem chave de app, corpo ignorado): limite por IP; `webhookKey` desconhecida → 404; `type` (consulta) diferente de `payment` → 200 sem fazer nada; `data.id` ausente → 200; assinatura inválida → 401 SEM consultar nada; consulta `getPayment` com o token DAQUELA conta; falha → 503 (o Mercado Pago tenta de novo); `externalReference` que não é pedido desta conta → 200 sem mudar nada (registra só "referência desconhecida"); senão `applyPayment` num contexto de sistema (`createSystemContext`) → 200. Resposta sempre sem corpo e sem detalhe. **`applyPayment`** sob `$lockKey('order', orderId)`: grava ou atualiza `payments` pela chave `(business_id, provider, provider_payment_id)` com a situação da consulta; depois: `approved` com `amountCents === total_cents` e `currency === 'BRL'` → se `AWAITING_PAYMENT`, vira `PAID` (`paid_at`) e chama `orderPaid`; se `EXPIRED` ou `CANCELED` com estoque já devolvido, tenta reservar de novo (`updateMany` condicional) e vira `PAID`, com `attention = stock_shortfall` se não houver estoque; se já `PAID`, nada; `approved` com valor ou moeda diferentes → só o pagamento é gravado e `attention = amount_mismatch` (pedido não muda); `refunded` ou `charged_back` em pedido `PAID` → `CANCELED` com o motivo "Pagamento devolvido no Mercado Pago", `orderVoided(…, 'refunded')`, e `attention = payment_reversed` se a entrega já tinha saído de `PENDING`; `rejected`, `cancelled`, `pending`, `in_process` → só o pagamento muda. Nunca usa nada do corpo da notificação. **Varredura** (`sweepStore`, tipo `store` no agendador, a cada minuto; lista as contas pelo `prisma` cru e age por `createSystemContext`): para cada pedido `AWAITING_PAYMENT` vencido com `mp_preference_id`, chama `syncOrderPayments` (se o Mercado Pago falhar, deixa o pedido para a próxima rodada, até 24 h depois do vencimento, e então vence); depois `expireOverdueOrders`. Funciona com a Loja desligada. API: `POST /v1/store/orders/{id}/checkout` (cliente, `module: 'store'`, limite 10/min por pessoa).

- [ ] **Step 1: Testes que falham:** `verifyMercadoPagoSignature` com o vetor calculado no teste (segredo, `data.id` "123ABC" → manifesto em minúsculas, `x-request-id`, `ts`) → verdadeiro; um caractere trocado em `v1`, outro `ts`, outro `data.id`, cabeçalho ausente ou sem `v1=` → falso; conversões `1990 ↔ "19.90"`, `5 ↔ "0.05"`, `"10.1"` → 1010; `startCheckout` sem Mercado Pago configurado → `payment_unavailable`; com o falso: itens + frete somam o total, `external_reference` é o pedido, segunda chamada reaproveita a preferência; `returnUrl` fora das origens da chave → `validation`; pedido vencido → `invalid_transition`; webhook sem assinatura → 401 e o falso não recebeu nenhuma consulta; assinatura com o segredo de outra conta → 401; `webhookKey` inexistente → 404; assinatura certa, pagamento aprovado com o valor certo → pedido `PAID`, uma linha em `payments`; a mesma notificação 3 vezes em sequência e 3 em paralelo → uma linha, pedido `PAID`, estoque inalterado; pagamento de outra conta (referência a pedido de B, chave de A) → 200 e nada muda em B; aprovado com R$ 0,01 a menos → pedido `AWAITING_PAYMENT` e `attention = amount_mismatch`; consulta falhando → 503 e nada gravado; `type=merchant_order` → 200 sem consulta; aprovado depois de vencido com estoque → `PAID` e estoque baixado de novo; sem estoque → `PAID` com `stock_shortfall`; estorno de pedido pago com entrega `PENDING` → `CANCELED` e estoque devolvido uma vez; corpo da notificação dizendo `approved` com o falso dizendo `rejected` → pedido não muda; `sweepStore`: pedido vencido cujo pagamento foi aprovado e o webhook se perdeu vira `PAID`, outro sem pagamento vira `EXPIRED`, e o Mercado Pago fora do ar adia o vencimento; Loja desligada: webhook e varredura ainda processam; o agendador grava a execução com tipo `store`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde (testes de concorrência 3 vezes seguidas) e build.
- [ ] **Step 3:** Commit: `feat: pagamento da loja pelo Mercado Pago (checkout, webhook assinado e varredura)`.

---

### Task 8: Loja — telas de pedidos no painel

**Files:**
- Create: `src/app/painel/(app)/loja/pedidos/**` (lista na aba `?aba=pedidos`, padrão da Loja, e detalhe `pedidos/[id]` com ações), `src/ui/components/OrderStatusBadge.tsx`, `src/server/domain/store/simulate.ts`
- Modify: `src/app/painel/(app)/loja/page.tsx` (aba Pedidos primeiro), `src/app/painel/(app)/clientes/[id]/page.tsx` (pedidos do cliente, com a Loja ligada), `src/app/dev/vitrine/**` (o selo novo), `scripts/smoke-pages.ts`
- Test: `tests/integration/painel-store-orders-actions.test.ts`, `tests/unit/ui-order-status-badge.test.tsx`

**Interfaces:**
- Consumes: Tarefas 6 e 7 (`listOrders`, `getOrder`, `cancelOrder`, `advanceFulfillment`, `applyPayment`), lista de pagamentos do pedido (acrescentar `listOrderPayments(ctx, orderId): Promise<{ status: PaymentStatus; amountCents: number; providerPaymentId: string; updatedLabel: string }[]>` em `store/payments.ts`).
- Produces: `simulateApprovedPayment(ctx: TenantContext, orderId: string): Promise<void>` — só com `INTEGRATIONS_MODE=fake` (senão `forbidden`), `manage_store`; registra no Mercado Pago falso um pagamento aprovado com o valor do pedido e passa por `applyPayment` (o mesmo caminho do webhook).

Regras: lista paginada com filtros na URL (`situacao=aguardando|a-entregar|entregues|cancelados`, busca por número ou nome do cliente), cada pedido com número (`#1024`), cliente, total, situação e entrega em texto, e o selo de atenção ("Valor divergente", "Pago sem estoque", "Pagamento devolvido") quando houver. Detalhe: itens com preço da compra, totais, cliente com link para a ficha, retirada (instruções) ou entrega (serviço, prazo, endereço copiado, código de rastreio), pagamentos (situação, valor, identificador do Mercado Pago, quando), linha do tempo curta (criado, pago, entregue ou cancelado), e ações por `manage_store`: avançar a entrega com o rótulo do próximo passo ("Marcar pronto para retirar", "Marcar como enviado" com campo de rastreio, "Marcar como entregue"), "Voltar um passo", "Cancelar pedido" (confirmação; para pedido pago o texto "O estorno do pagamento é feito no painel do Mercado Pago. Cancelar aqui devolve os itens ao estoque se ainda não saíram.") e, só no modo falso, "Simular pagamento aprovado" num aviso "Ambiente de teste". Explicação curta para cada atenção (o que houve e o que fazer). A 375 px a lista vira cartões. Ficha do cliente: os 5 últimos pedidos com link.

- [ ] **Step 1: Testes que falham** (ações e páginas chamadas direto): profissional abrindo `/loja/pedidos/<id>` → sem permissão; gerente avança `PENDING → READY_FOR_PICKUP` num pedido de retirada e a página mostra o próximo passo; pular para `DELIVERED` num pedido de entrega `PENDING` → mensagem de transição inválida; cancelar pedido pago pela tela devolve o estoque; "Simular pagamento aprovado" com `INTEGRATIONS_MODE=real` → recusado e com `fake` → pedido pago; pedido da conta B por id → 404; Loja desligada → 404; filtro `situacao=a-entregar` só traz pagos não entregues; `OrderStatusBadge` dá texto para toda combinação de situação e atenção.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes (`/loja?aba=pedidos`, `/loja?aba=pedidos&situacao=a-entregar&search=1`, `/loja/pedidos/{pedido}`).
- [ ] **Step 3:** Commit: `feat: pedidos da loja no painel do negócio`.

---

### Task 9: Vouchers — parceiros, venda pela loja, códigos e baixa — SENSÍVEL

**Files:**
- Create: `src/server/domain/vouchers/{partners,vouchers,codes}.ts`, `src/server/api/schemas/vouchers.ts`, `src/app/api/v1/vouchers/{route.ts,[id]/route.ts}`, `src/app/api/v1/me/voucher-codes/route.ts`, `src/app/painel/(app)/vouchers/**` (abas Dar baixa, Vouchers, Parceiros, Códigos; `novo`, `[id]`, `[id]/imagem/route.ts`, `parceiros/novo`, `parceiros/[id]`, `parceiros/[id]/logo/route.ts`), migração `20261119060000_vouchers`
- Modify: `prisma/schema.prisma`, `src/server/db/models.ts`, `src/server/domain/store/{cart,orders,order-events}.ts` (linhas de voucher, entrega `NONE`, códigos), `src/server/domain/errors.ts` (`already_redeemed`, `code_expired`, `code_void`, `codes_in_use`), `src/server/api/schemas/store.ts`, `src/server/api/routes-manifest.ts`, `scripts/smoke-pages.ts`
- Test: `tests/integration/vouchers.test.ts`, `tests/integration/voucher-orders.test.ts`, `tests/integration/voucher-codes-race.test.ts`, `tests/unit/voucher-code-format.test.ts`, `tests/integration/api/voucher-routes.test.ts`, `tests/integration/painel-vouchers-actions.test.ts`

**Interfaces:**
- Consumes: Tarefas 5–7 (`priceCart`, `createOrder`, `orderPaid`, `orderVoided`, `cancelOrder`), `receberImagem`.
- Produces:

```ts
// vouchers/partners.ts
export type PartnerInput = { name: string; description: string | null; address: string | null; phone: string | null; website: string | null; active: boolean }
export type PartnerView = PartnerInput & { id: string; logoUrl: string | null; voucherCount: number; archivedAt: Date | null }
export function listPartners(ctx: TenantContext, q?: { includeArchived?: boolean }): Promise<PartnerView[]>
export function createPartner(ctx: TenantContext, i: PartnerInput): Promise<PartnerView>
export function updatePartner(ctx: TenantContext, id: string, i: Partial<PartnerInput>): Promise<PartnerView>
export function archivePartner(ctx: TenantContext, id: string): Promise<void>
export function setPartnerLogo(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<PartnerView>
// vouchers/vouchers.ts
export type VoucherInput = { partnerId: string; name: string; description: string | null; terms: string | null; priceCents: number; stock: number; validDays: number | null; active: boolean }
export type VoucherView = VoucherInput & { id: string; imageUrl: string | null; partnerName: string; displayOrder: number; archivedAt: Date | null; sold: number; redeemed: number }
export type PublicVoucher = { id: string; name: string; description: string | null; terms: string | null; priceCents: number; validDays: number | null; available: boolean; maxQuantity: number; imageUrl: string | null; partner: { name: string; address: string | null; phone: string | null; website: string | null; logoUrl: string | null } }
export function listVouchers(ctx: TenantContext, q?: { partnerId?: string; situation?: 'active' | 'inactive' | 'archived' }): Promise<VoucherView[]>
export function listPublicVouchers(ctx: TenantContext): Promise<PublicVoucher[]>
export function getPublicVoucher(ctx: TenantContext, id: string): Promise<PublicVoucher>
export function createVoucher(ctx: TenantContext, i: VoucherInput): Promise<VoucherView>
export function updateVoucher(ctx: TenantContext, id: string, i: Partial<VoucherInput>): Promise<VoucherView>
export function archiveVoucher(ctx: TenantContext, id: string): Promise<void>
export function setVoucherImage(ctx: TenantContext, id: string, file: { bytes: Uint8Array } | null): Promise<VoucherView>
// vouchers/codes.ts
export type VoucherCodeView = { id: string; code: string; status: 'ACTIVE' | 'REDEEMED' | 'VOID' | 'EXPIRED'; voucher: { id: string; name: string }; partnerName: string; customer: { id: string; name: string }; orderNumber: number; expiresLabel: string | null; redeemedLabel: string | null; voidReason: string | null }
export function generateVoucherCode(): string   // 8 caracteres de "23456789ABCDEFGHJKMNPQRSTUVWXYZ" em dois grupos: "K7QM-4XHT"
export function normalizeVoucherCode(input: string): string | null
export function issueCodesForOrder(tx: TenantTx, ctx: TenantContext, orderId: string): Promise<number>
export function voidCodesForOrder(tx: TenantTx, ctx: TenantContext, orderId: string, reason: string): Promise<number>
export function findVoucherCode(ctx: TenantContext, code: string): Promise<VoucherCodeView>
export function redeemVoucherCode(ctx: TenantContext, code: string): Promise<VoucherCodeView>
export function listVoucherCodes(ctx: TenantContext, q?: { status?: VoucherCodeView['status']; voucherId?: string; search?: string; cursor?: string; limit?: number }): Promise<{ items: VoucherCodeView[]; nextCursor: string | null }>
export function listMyVoucherCodes(ctx: TenantContext): Promise<VoucherCodeView[]>
// store/cart.ts
export type CartLine = { productId: string; quantity: number } | { voucherId: string; quantity: number }
```

Regras: voucher pertence a um parceiro ativo; preço > 0, estoque 0–100.000, `validDays` 1–730 ou sem validade. **Venda**: o carrinho aceita linhas de voucher só com o módulo Vouchers ligado (senão `module_disabled`); preço e nome copiados como nos produtos; estoque reservado da mesma forma; carrinho só de vouchers usa `delivery: { method: 'NONE' }` (e `PICKUP`/`SHIPPING` são recusados), carrinho misto segue as regras da Tarefa 6 (vouchers não entram no peso do frete). **Códigos**: `orderPaid` chama `issueCodesForOrder`, que cria `quantity` códigos por linha de voucher com `seq` 1..quantidade (`createMany` com `skipDuplicates`: repetir não duplica) e `expires_at` = fim do dia local (`paid_at` + `validDays`) no fuso da conta; colisão de código (único na conta) → gera outro, até 5 tentativas. `orderVoided` chama `voidCodesForOrder`: `ACTIVE` → `VOID` com o motivo; `REDEEMED` fica e, se houver algum, o pedido recebe `attention = payment_reversed` quando o motivo é estorno; o cancelamento pela equipe de pedido com código já usado é recusado (`conflict`/`codes_in_use`). Situação `EXPIRED` é calculada na leitura (`ACTIVE` com `expires_at` passado), não gravada. **Baixa** (`manage_vouchers`): `normalizeVoucherCode` aceita minúsculas, espaços e sem hífen; código inexistente ou de outra conta → `not_found`; numa transação com UPDATE condicional `status = 'ACTIVE' AND (expires_at IS NULL OR expires_at > agora)`: 0 linhas → relê e devolve `already_redeemed` (com quando e por quem), `code_void` ou `code_expired`; auditoria `voucher_code.redeemed`. API (`module: 'vouchers'`): `GET /v1/vouchers` e `GET /v1/vouchers/{id}` (`key`), `GET /v1/me/voucher-codes` (cliente; os próprios, com código, situação, validade e parceiro). Telas (`manage_vouchers`): aba "Dar baixa" primeiro (campo grande para o código, resultado em cartão: "Código válido: <voucher> de <parceiro>, comprado por <cliente>" com o botão "Dar baixa", ou o motivo da recusa em texto), Vouchers (lista com vendidos e usados, formulário com imagem), Parceiros (lista, formulário com logo), Códigos (lista paginada com filtro de situação e busca). Os pedidos com vouchers aparecem também na tela de pedidos da Loja, com os códigos no detalhe.

- [ ] **Step 1: Testes que falham:** `generateVoucherCode` só usa o alfabeto, tem o formato `XXXX-XXXX`, e 10.000 gerados não repetem; `normalizeVoucherCode(' k7qm4xht ')` = `K7QM-4XHT` e texto com `0` ou `O` → `null`; carrinho com voucher com o módulo desligado → `module_disabled`; carrinho só de vouchers com `PICKUP` → `validation` e com `NONE` → pedido; pagamento aprovado de pedido com 2 unidades → 2 códigos; a mesma notificação 3 vezes (inclusive em paralelo) → 2 códigos; validade de 30 dias em Manaus vence às 23:59:59.999 locais do 30º dia; baixa duas vezes → a segunda `already_redeemed`; duas baixas simultâneas do mesmo código → uma passa; código vencido → `code_expired`; código de outra conta → `not_found`; estorno no Mercado Pago anula os códigos ativos e mantém o usado, com `payment_reversed`; equipe cancelando pedido com código usado → `codes_in_use`; profissional dando baixa → "sem permissão"; cliente vê só os próprios códigos em `/v1/me/voucher-codes`; rotas com Vouchers desligado → 404 `module_disabled`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes (`/vouchers`, `/vouchers?aba=vouchers`, `/vouchers?aba=parceiros`, `/vouchers?aba=codigos&situacao=ACTIVE`, `/vouchers/novo`, `/vouchers/parceiros/novo`).
- [ ] **Step 3:** Commit: `feat: vouchers (parceiros, venda pela loja, códigos e baixa)`.

---

### Task 10: Fechamento da fase

**Files:**
- Create: `src/server/domain/platform/module-usage.ts`
- Modify: `src/app/dev/(app)/contas/[id]/modulos/page.tsx` e `FormsConta.tsx` (avisos), `prisma/seed.ts`, `prisma/seed-data.ts`, `scripts/smoke-pages.ts`, `tests/unit/painel-guards.test.ts`, `tests/integration/seed.test.ts`, `README.md` (seção curta "Módulos e integrações"; o arquivo fica em até 110 linhas), `.env.example` (`INTEGRATIONS_MODE`), `docs/superpowers/pendencias-proximas-fases.md`

**Interfaces:**
- Produces: `getModuleUsage(actor: PlatformAdminActor, businessId: string): Promise<{ openOrders: number; pendingRedemptions: number; activeVoucherCodes: number; mercadoPagoConfigured: boolean }>`

Regras: aba Módulos do painel dev: ao lado de cada módulo, o que está em andamento ("3 pedidos pagos a entregar", "2 resgates a entregar", "14 códigos de voucher ativos") e o aviso de que desligar esconde tudo isso da conta e do app, mas guarda os dados; Loja ligada sem Mercado Pago: aviso com link para a aba Integrações; Vouchers com Loja desligada continua recusado com a mensagem atual. Seed: Navalha de Ouro (todos os módulos) com 2 categorias, 5 produtos (um com promoção, um sem estoque), 3 prêmios, 2 banners no ar e 1 agendado, 1 parceiro e 2 vouchers, pontos creditados pelos atendimentos concluídos do seed (pela função de domínio, não por inserção direta), 1 resgate pendente, 1 pedido pago a entregar, 1 aguardando pagamento e 1 com vouchers e códigos; Mercado Pago e Frenet com credenciais de teste falsas cifradas (texto `TEST-…` gerado no seed, nunca impresso). Patas e Pelos (Fidelidade e Banners) com prêmios e um banner. Fumaça: todas as páginas novas pedidas na conta com todos os módulos e o 404 de `/loja` e `/vouchers` na conta sem Loja. Pendências: mover para "Fase 6" o que ficou (ver "Decisões do plano").

- [ ] **Step 1:** Testes que falham: `getModuleUsage` conta só a própria conta; o teste estático de guardas pega as páginas, ações e rotas novas (toda `page.tsx` dos quatro módulos chama `requirePainelModule` depois de `requireTenant`); teste do seed (contagens acima, saldo de pontos = soma do extrato). → FALHA. Implementar.
- [ ] **Step 2: Verificação final:** `npm run typecheck && npm run lint && npm test && npm run test:tz && npm run build && npm run smoke`; `grep -rn "from '@/server/db/client'" src/app` → vazio; `grep -rniE "sejasans|sans (company|club|coins)|clube_sans|barber" src prisma scripts tests` → vazio; `grep -rn "fetch(" src --include=*.ts` só em `src/server/integrations/` (e nos usos que já existiam).
- [ ] **Step 3:** Commit: `feat: seed, fumaça e avisos dos módulos`.

---

## Decisões do plano (para o coordenador conferir)

1. **Vouchers × Loja**: desligar a Loja com Vouchers ligado é RECUSADO (comportamento que já existe em `updateModules`), não desliga os dois. Motivo: desligar um módulo esconde dados da conta e do app; fazer isso em silêncio com um segundo módulo surpreende o admin. Para desligar os dois, ele desmarca os dois no mesmo envio. A Tarefa 10 mostra o que está em andamento antes.
2. **Integrações só pelo admin**: o dono vê a situação (configurado ou não) em Loja > Configurações e não edita. A spec (§10, §12.2) dizia que o dono ajusta integrações; o coordenador decidiu pelo admin. SMTP próprio por conta fica fora desta fase.
3. **`business_integrations` é modelo de plataforma**: inacessível por `tenantDb`; leitura de segredos só por `integration-secrets.ts`, com teste que limita quem importa.
4. **Estoque reservado na criação do pedido** (o sistema antigo só baixava na aprovação e podia vender o que não tinha). Prazo para pagar: 60 min por padrão (15 a 1.440 configurável); a preferência do Mercado Pago vence junto. Pagamento aprovado depois do vencimento ainda vale: reserva de novo ou marca "Pago sem estoque" para o dono resolver.
5. **Boleto fora** do checkout (só cartão, Pix e saldo do Mercado Pago), porque compensa em dias e o prazo do pedido é de minutos.
6. **Sem estorno automático**: cancelar pedido pago no painel não devolve o dinheiro; o dono estorna no Mercado Pago, e o webhook de estorno atualiza o pedido.
7. **Frete com cotação assinada** (HMAC, 30 min) em vez de tabela de cotações ou de nova cotação na criação do pedido: o servidor não confia no valor e não depende da Frenet duas vezes.
8. **Webhook**: endereço por conta com chave opaca aleatória (não o slug nem o id); sem janela de tempo na assinatura (o Mercado Pago repete notificações antigas, e o estado sempre vem da consulta); a varredura por `external_reference` cobre notificação perdida ou sem assinatura. Webhook fora do OpenAPI (não é do app).
9. **Pontos**: crédito só com Fidelidade ligada na hora da conclusão; estorno sempre; estorno pode deixar saldo negativo; ajuste manual não. Pontos não vencem. Ranking pelos pontos ganhos no mês local corrente (não pelo saldo, para não punir quem resgata). Resgate nasce pendente (entregue no balcão depois) ou já entregue quando a equipe registra no balcão.
10. **Sem avisos novos** (e-mail ou push) de pedido, pagamento, resgate ou código nesta fase; a fila de avisos continua só com os eventos de agendamento.
11. **Banner nasce inativo e sem imagem**, e só fica ativo com imagem (fluxo igual ao das outras telas, sem formulário multipart de criação). Banner é excluído de verdade (não tem histórico).
12. **Profissional** não gerencia nenhum módulo; lê saldo e extrato de pontos na ficha do cliente.
13. **Modo de integrações** por `INTEGRATIONS_MODE` (falso fora de produção, real em produção); o modo falso tem "Simular pagamento aprovado" no detalhe do pedido para o dono testar sem Mercado Pago.
14. **Fora desta fase** (vão para as pendências): volume financeiro da loja nas métricas do painel dev; rotas `staff/*` de módulos para o app da equipe; rotação da chave de cifra dos segredos.
