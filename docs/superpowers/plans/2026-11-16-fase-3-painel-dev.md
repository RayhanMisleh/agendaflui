# AgendaFlui — Fase 3: Painel dev — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar aos admins da plataforma o painel `dev.` completo: criar e personalizar contas com prévia ao vivo, gerenciar equipe, chaves de app e admins, entrar como suporte numa conta, e acompanhar métricas, sistema e auditoria.

**Architecture:** Toda regra fica em `src/server/domain/platform/**` (funções que recebem o ator admin da plataforma e gravam auditoria) e em `src/server/auth/**` (convite, suporte). As telas em `src/app/dev/(app)/**` são componentes de servidor que chamam o domínio; formulários usam ações de servidor finas (`actions.ts` por pasta) que validam com o esquema do domínio e devolvem erros por campo. Nenhuma tela importa o Prisma.

**Tech Stack:** a mesma das fases anteriores (Next.js 16, React 19, Prisma 7, Zod 4, design system `af-*`). Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-13-agendaflui-design.md` — seções 9.1, 10, 11 e 12.1. Pendências herdadas: `docs/superpowers/pendencias-proximas-fases.md`, seção "Fase 3".

## Global Constraints

- Vale tudo de `AGENTS.md`: TypeScript estrito, sem `any`; data e hora só por `src/server/time/`; `z` de `@/server/domain/errors`; textos em pt-BR, frase simples, voz ativa; nenhum domínio fixo; nenhum termo do sistema antigo; commits locais, nunca `git push`; sem formatador automático.
- Regra de negócio só em `src/server/`. Telas e ações não importam `@/server/db/client` nem `tenantDb`.
- Toda função de `src/server/domain/platform/**` confere em execução que o ator é admin da plataforma (`forbidden` senão) e grava auditoria com o admin como autor, na mesma transação da escrita. Segredos e senhas nunca entram em auditoria, log, erro ou URL.
- Toda página do painel dev começa por `requirePlatformAdmin()`. Toda ação de servidor também (ação é rota pública: nunca confie só na página).
- Visual: o design system existente (`src/ui/**`, classes `af-*`, moldura `DevShell`, linguagem "mesa de controle" em metal). Antes de desenhar telas novas, o implementador carrega a skill `frontend-design:frontend-design` e segue a seção 11 da spec; não cria um segundo estilo. Toda tela funciona a 375 px, tem foco visível, respeita `prefers-reduced-motion`, e nunca põe texto sobre gradiente nem com `opacity`.
- Formulário funciona sem JavaScript (ação de servidor em `<form action>`); com JavaScript, mostra o erro ao lado do campo e mantém o que foi digitado. Ação destrutiva (arquivar, revogar, desativar) pede confirmação com o nome do alvo.
- Listas com mais de 50 itens são paginadas no servidor (cursor), com busca e filtros na URL.
- Sem testes de navegador (Playwright): não rodar `npm run test:e2e` nem criar teste novo de navegador. Verificação de cada tarefa: `npm run typecheck && npm run lint && npm test`, mais `npm run build` quando houver tela ou rota. Componentes com lógica têm teste com Testing Library (jsdom), como os existentes em `tests/unit/`.
- Migração nova por tabela nova, com data posterior às existentes; nunca editar migração antiga; modelo novo classificado em `src/server/db/models.ts`.
- Não criar arquivos de documentação além dos listados.

## Review Focus

1. **Dono que já existe**: criar conta com o e-mail de um usuário que já é dono ou membro de outra conta vincula o usuário existente, não troca a senha dele e não manda convite de definir senha (manda aviso de acesso novo). Teste na Tarefa 1.
2. **Cor extrema na marca** (branco, preto, amarelo neon, cor igual ao papel): o painel da conta continua legível, o formulário avisa o ajuste, e nada quebra na prévia. Teste na Tarefa 2.
3. **Token de suporte reutilizado ou vencido, e admin desativado no meio de uma sessão de suporte**: o segundo uso falha, o vencido falha, e a sessão de suporte cai na requisição seguinte à desativação. Teste na Tarefa 3.
4. **Dois admins editando a mesma conta**: quem grava por último sobre uma versão antiga recebe aviso de conflito, não sobrescreve em silêncio. Teste nas Tarefas 1 e 2.
5. **Tirar o próprio acesso**: desativar a si mesmo, o último admin ativo da plataforma ou o último dono ativo de uma conta é recusado com mensagem que diz o que fazer. Teste na Tarefa 3.

---

## Mapa de arquivos

```
src/server/domain/platform/businesses.ts        contas: listar, criar, editar, situação, detalhe
src/server/domain/platform/customization.ts     marca, termos, módulos, regras, fuso, avisos (pelo admin)
src/server/domain/platform/team.ts              equipe de uma conta (convidar, papel, desativar)
src/server/domain/platform/admins.ts            admins da plataforma, perfil e senha
src/server/domain/platform/metrics.ts           visão geral e métricas por conta
src/server/domain/platform/system.ts            fila de avisos, banco, agendador, erros
src/server/domain/platform/audit-log.ts         consulta da auditoria
src/server/auth/invites.ts                      convite de acesso (definir senha)
src/server/auth/support-session.ts              entrar como (token de passagem e sessão de suporte)
src/app/dev/(app)/**                            telas e ações do painel dev
src/app/painel/definir-senha/[token]/           tela de definir senha do convite
src/app/painel/suporte/[token]/route.ts         troca do token de suporte pela sessão
src/ui/components/**, src/ui/shells/**          componentes novos e ajustes das molduras
```

---

### Task 1: Contas (domínio) e convite do dono

**Files:**
- Modify: `src/server/domain/platform/businesses.ts`, `src/server/time/index.ts` (`canonicalTimeZone`), `src/server/hosts.ts` (`areaUrl` valida barra inicial), `prisma/schema.prisma` + migração (coluna `version` inteira em `businesses`, padrão 1)
- Create: `src/server/auth/invites.ts`, `src/app/painel/definir-senha/[token]/{page.tsx,actions.ts}`, `src/server/notifications/render-invite.ts`
- Test: `tests/integration/platform-businesses.test.ts`, `tests/integration/invites.test.ts`, `tests/unit/time-zone-canonical.test.ts`

**Interfaces:**
- Consumes: `PlatformAdminActor`, `audit`, `getEmailChannel`, moldura de e-mail da fase 2B, `hashPassword`, `passwordSchema`, `normalizeEmail`, `UserToken` (confira os propósitos existentes; acrescente `INVITE` se faltar, em migração).
- Produces:

```ts
// businesses.ts
export type BusinessStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED'
export type BusinessRow = { id: string; slug: string; name: string; status: BusinessStatus; createdAt: Date; ownerName: string | null; entryUrl: string }
export function listBusinesses(actor: PlatformAdminActor, q?: { search?: string; status?: BusinessStatus; cursor?: string; limit?: number }): Promise<{ items: BusinessRow[]; nextCursor: string | null }>
export type BusinessDetail = BusinessRow & { version: number; legalName: string | null; document: string | null; contactEmail: string | null; contactPhone: string | null; timeZone: string; internalNotes: string | null; modules: Modules }
export function getBusinessDetail(actor: PlatformAdminActor, id: string): Promise<BusinessDetail>
export function createBusiness(actor: PlatformAdminActor, i: { name: string; slug: string; timeZone: string; legalName?: string; document?: string; contactEmail?: string; contactPhone?: string; internalNotes?: string; owner: { name: string; email: string } }, now?: Date): Promise<{ business: BusinessDetail; owner: { userId: string; existing: boolean } }>
export function updateBusinessData(actor: PlatformAdminActor, id: string, version: number, patch: Partial<{ name: string; slug: string; legalName: string | null; document: string | null; contactEmail: string | null; contactPhone: string | null; internalNotes: string | null }>): Promise<BusinessDetail>
export function setBusinessStatus(actor: PlatformAdminActor, id: string, to: BusinessStatus, i: { confirmName: string }): Promise<BusinessDetail>
// invites.ts
export function issueInvite(tx: PlatformTx, userId: string, now: Date): Promise<{ token: string; expiresAt: Date }>   // 7 dias, só o hash no banco, substitui convite anterior
export function readInvite(token: string, now: Date): Promise<{ userName: string; email: string } | null>
export function acceptInvite(i: { token: string; password: string }, now: Date): Promise<void>                            // define a senha, consome o token, revoga sessões antigas
// time/index.ts
export function canonicalTimeZone(input: string): string   // 'america/sao_paulo' → 'America/Sao_Paulo'; inválido lança DomainError de validação
```

Regras: `slug` com 3 a 40 caracteres `[a-z0-9-]`, sem hífen nas pontas, único, e fora de uma lista reservada (`entrar`, `sair`, `api`, `dev`, `painel`, `arquivos`, `suporte`, `definir-senha`, `escolher-conta`, `admin`, `www`). `createBusiness`, numa transação: conta `ACTIVE`, marca padrão (nome de exibição = nome), regras e avisos padrão, e o dono — se o e-mail já é de um usuário, cria só o vínculo `OWNER` (sem tocar na senha); senão cria o usuário sem senha e emite convite. Depois do commit envia o e-mail (convite com link `areaLink('painel', '/definir-senha/<token>')`, ou "você agora tem acesso a <conta>" para usuário existente); falha de envio não desfaz a conta e fica visível no retorno. `updateBusinessData` exige `version` igual à gravada (senão `conflict` com `reason: 'stale_version'`) e incrementa. Trocar o `slug` troca o link de entrada: a função devolve o novo `entryUrl`. `setBusinessStatus`: transições válidas `ACTIVE ↔ SUSPENDED`, qualquer → `ARCHIVED`, `ARCHIVED → ACTIVE`; `confirmName` tem de ser igual ao nome da conta; ao sair de `ACTIVE`, revoga as sessões do painel dos membros da conta (os tokens do app caem sozinhos: o contexto relê a conta). `document` aceita CPF ou CNPJ só com dígitos, com dígito verificador conferido. `listBusinesses` busca por nome, slug e e-mail do dono, sem diferenciar acento. A tela de definir senha (`painel.`): token inválido ou vencido → mensagem com o que fazer; senha pelo `passwordSchema`; no sucesso, vai para `/entrar`.

- [ ] **Step 1: Testes que falham:** criar conta com e-mail novo → usuário sem senha, vínculo `OWNER`, convite emitido (só hash no banco) e um e-mail no canal falso com o link; com e-mail de usuário existente → `existing: true`, senha intacta, nenhum convite, e-mail de aviso; slug reservado, duplicado, com maiúscula ou com hífen na ponta → `validation` no campo `slug`; fuso `america/manaus` grava `America/Manaus` e fuso inexistente falha; CNPJ com dígito errado falha; `updateBusinessData` com `version` antiga → `conflict` `stale_version` e nada muda; duas edições simultâneas com a mesma versão: uma passa; `setBusinessStatus` com `confirmName` errado falha; suspender revoga as sessões do painel dos membros; transição inválida falha; busca "joao" acha dono "João"; paginação estável; toda escrita tem linha de auditoria com o admin; `acceptInvite` define a senha, consome o token e o segundo uso falha; convite vencido falha; novo convite invalida o anterior; ator que não é admin → `forbidden` em todas.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: contas da plataforma (criar, editar, situação) e convite do dono`.

---

### Task 2: Personalização da conta (domínio)

**Files:**
- Create: `src/server/domain/platform/customization.ts`, `src/shared/theme/preview.ts`
- Modify: `src/server/auth/context.ts` (contexto de conta para admin da plataforma, se não existir), `src/server/storage/{local-disk,images}.ts` e `src/app/arquivos/[...key]/route.ts` (pendências de upload), `src/shared/theme/derive.ts` (avisos)
- Test: `tests/integration/platform-customization.test.ts`, `tests/unit/theme-preview.test.ts`, `tests/integration/uploads-hardening.test.ts`

**Interfaces:**
- Consumes: `deriveTheme`, `getSchedulingRules`/`updateSchedulingRules`, `getNotificationSettings`/`updateNotificationSettings`, funções de upload de imagem da Fase 1, `BusinessDetail.version` (Tarefa 1).
- Produces:

```ts
export type BrandInput = { displayName: string; primary: string; accent: string; material: 'LEATHER' | 'LINEN' | 'WOOD' | 'ENAMEL'; paper: 'WHITE' | 'CREAM' | 'GRAY'; fontPair: string; loginMessage: string | null }
export type BrandView = BrandInput & { logoUrl: string | null; symbolUrl: string | null; faviconUrl: string | null; loginImageUrl: string | null; version: number }
export function getCustomization(actor: PlatformAdminActor, businessId: string): Promise<{ brand: BrandView; terms: Terms; modules: Modules; rules: SchedulingRules; timeZone: string; notifications: NotificationSettings }>
export function updateBrand(actor: PlatformAdminActor, businessId: string, version: number, i: BrandInput): Promise<BrandView>
export function setBrandImage(actor: PlatformAdminActor, businessId: string, slot: 'logo' | 'symbol' | 'favicon' | 'loginImage', file: { bytes: Uint8Array; mime: string } | null): Promise<BrandView>
export function updateTerms(actor: PlatformAdminActor, businessId: string, i: Terms): Promise<Terms>
export function updateModules(actor: PlatformAdminActor, businessId: string, i: Modules): Promise<Modules>
export function updateRulesAsAdmin(actor: PlatformAdminActor, businessId: string, i: Partial<SchedulingRules> & { timeZone?: string }): Promise<{ rules: SchedulingRules; timeZone: string }>
export function updateNotificationsAsAdmin(actor: PlatformAdminActor, businessId: string, i: NotificationSettings): Promise<NotificationSettings>
// shared/theme/preview.ts (puro, usado pelo servidor e pela prévia no navegador)
export type ThemeWarning = 'text_adjusted' | 'accent_adjusted' | 'relief_collapsed'
export function previewTheme(i: Pick<BrandInput, 'primary' | 'accent' | 'material' | 'paper' | 'fontPair'>): { tokens: Record<string, string>; warnings: ThemeWarning[] }
```

Regras: cores em hexadecimal de 6 dígitos (`#rrggbb`), normalizadas em minúsculas. `fontPair` de uma lista fechada exportada (as opções curadas da Fase 1). `previewTheme` devolve as mesmas variáveis que o painel aplica e os avisos: `text_adjusted` quando o texto sobre a capa foi trocado para manter contraste AA, `accent_adjusted` quando o destaque foi ajustado, `relief_collapsed` quando o relevo da capa some (cor muito clara ou muito escura). `updateBrand` usa a versão da marca (coluna `version` em `business_brandings`, migração nesta tarefa) como na Tarefa 1. Termos: singular e plural de profissional, cliente e pontos, e o nome do clube; 1 a 30 caracteres, sem `<`/`>`. Módulos: `vouchers` exige `store` (ligar vouchers sem loja, ou desligar loja com vouchers ligado → `validation` com mensagem que explica). Fuso passa por `canonicalTimeZone`; trocar o fuso de uma conta que já tem agendamentos futuros é permitido e grava na auditoria os dois fusos (os instantes não mudam; os rótulos locais passam a ser calculados no fuso novo). `updateRulesAsAdmin`/`updateNotificationsAsAdmin` chamam as funções de domínio existentes com um contexto de conta cujo ator é o admin. Imagens: mesmas regras da Fase 1 (tipo real conferido pelos bytes, tamanho e dimensões máximas, reescrita sem metadados); trocar uma imagem apaga o arquivo anterior. Pendências de upload: limpar `.meta`/`.tmp` quando a gravação falha no meio; a rota de arquivos não decodifica um segmento duas vezes e recusa link simbólico; a detecção de "imagem grande demais" não depende do texto do erro.

- [ ] **Step 1: Testes que falham:** `previewTheme` com branco puro, preto, amarelo `#ffff00` e cor igual ao papel: todo par texto/fundo dos tokens tem contraste ≥ 4,5 e os avisos certos aparecem; cor válida comum → sem avisos; `updateBrand` com cor `#FFF` ou `red` → `validation`; versão antiga → `conflict`; vouchers sem loja falha nos dois sentidos; termo com `<b>` falha; trocar o logo apaga o arquivo anterior do disco e do banco; arquivo que não é imagem (texto com extensão `.png`) falha; imagem acima do limite de pixels falha com mensagem clara; `setBrandImage(..., null)` remove; fuso trocado grava auditoria com antes e depois; regras alteradas pelo admin aparecem em `getSchedulingRules` da conta; falha no meio da gravação não deixa `.tmp` nem `.meta`; rota de arquivos com `%252e%252e` e com link simbólico → 404; ator que não é admin → `forbidden`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: personalização da conta pelo painel dev (marca, termos, módulos, regras) com prévia de tema`.

---

### Task 3: Equipe da conta, admins da plataforma e entrar como

**Files:**
- Create: `src/server/domain/platform/team.ts`, `src/server/domain/platform/admins.ts`, `src/server/auth/support-session.ts`, `src/app/painel/suporte/[token]/route.ts`
- Modify: `src/server/auth/{guards,member-auth,actor}.ts` (sessão de suporte e faixa), `prisma/schema.prisma` + migração (`support_handoffs`; campos de suporte na sessão do painel, se faltarem)
- Test: `tests/integration/platform-team.test.ts`, `tests/integration/platform-admins.test.ts`, `tests/integration/support-session.test.ts`

**Interfaces:**
- Consumes: `issueInvite` (Tarefa 1), `revokeAllFor` (tokens do app), ator `impersonator` e `requireTenant` existentes, limites de login da Fase 2B.
- Produces:

```ts
// team.ts
export type TeamMember = { membershipId: string; userId: string; name: string; email: string; role: MembershipRole; active: boolean; hasPassword: boolean; lastLoginAt: Date | null; professionalId: string | null }
export function listTeam(actor: PlatformAdminActor, businessId: string): Promise<TeamMember[]>
export function inviteMember(actor: PlatformAdminActor, businessId: string, i: { name: string; email: string; role: MembershipRole }, now?: Date): Promise<TeamMember>
export function changeMemberRole(actor: PlatformAdminActor, membershipId: string, role: MembershipRole): Promise<TeamMember>
export function setMemberActive(actor: PlatformAdminActor, membershipId: string, active: boolean): Promise<TeamMember>
export function resendInvite(actor: PlatformAdminActor, membershipId: string, now?: Date): Promise<void>
// admins.ts
export type AdminRow = { id: string; name: string; email: string; active: boolean; lastLoginAt: Date | null; createdAt: Date }
export function listAdmins(actor: PlatformAdminActor): Promise<AdminRow[]>
export function createAdmin(actor: PlatformAdminActor, i: { name: string; email: string; password: string }): Promise<AdminRow>
export function setAdminActive(actor: PlatformAdminActor, adminId: string, active: boolean): Promise<AdminRow>
export function updateOwnProfile(actor: PlatformAdminActor, i: { name: string }): Promise<AdminRow>
export function changeOwnPassword(actor: PlatformAdminActor, i: { current: string; next: string }, keepSessionToken: string): Promise<void>
// support-session.ts
export function startSupport(actor: PlatformAdminActor, businessId: string, now?: Date): Promise<{ url: string }>   // URL do host do painel com token de passagem
export function redeemSupport(token: string, meta: RequestMeta, now: Date): Promise<{ sessionToken: string; expiresAt: Date; slug: string } | null>
export function endSupport(sessionToken: string): Promise<void>
```

Regras de equipe: convidar com e-mail de usuário existente cria só o vínculo; mesmo usuário duas vezes na conta → `conflict`. Não se pode rebaixar nem desativar o último `OWNER` ativo da conta. Desativar um vínculo ou rebaixar um papel roda sob `$lockKey('membership', id)`, revoga as sessões do painel daquele usuário naquela conta e chama `revokeAllFor(tx, { membershipId })`. Reativar não ressuscita sessão. Regras de admins: e-mail único; senha pelo `passwordSchema`; desativar revoga todas as sessões do admin e as sessões de suporte abertas por ele; não se pode desativar a si mesmo nem o último admin ativo; `changeOwnPassword` confere a senha atual (limite de 5 tentativas por admin a cada 15 min), revoga as outras sessões e mantém a atual.
Entrada (pendências da Fase 1): um novo login no mesmo navegador revoga a sessão anterior daquele cookie (painel dev e painel do negócio); os testes cobrem "só o hash do token de sessão do admin fica no banco" e "e-mail em maiúsculas não contorna o limite de tentativas".
Entrar como: o cookie do painel dev não vale no host do painel, então `startSupport` grava um token de passagem (32 bytes, só o hash, validade de 60 segundos, uso único) em `support_handoffs` e devolve `areaLink('painel', '/suporte/<token>')`. A rota do painel troca o token por uma sessão do painel marcada como suporte (admin e conta gravados; validade de 60 minutos, sem renovação), define o cookie da sessão e redireciona para `/`. Token inválido, usado ou vencido → 404 sem detalhe. A sessão de suporte produz o ator `impersonator` (com os poderes do dono) e é relida a cada requisição: admin desativado ou conta `ARCHIVED` derruba a sessão; conta `SUSPENDED` continua acessível só para suporte. Iniciar e encerrar suporte gravam auditoria na conta, com o nome do admin; toda alteração feita em suporte já sai na auditoria como "admin X atuando na conta" (confira e complete `audit`). A moldura do painel mostra a faixa permanente "Você está em modo suporte na conta <nome>" com o botão "Encerrar", que apaga a sessão e volta ao painel dev.

- [ ] **Step 1: Testes que falham:** convite de membro novo emite convite e e-mail; de usuário existente só vincula; duplicado → `conflict`; rebaixar ou desativar o último dono ativo → recusado com mensagem; desativar vínculo revoga sessões do painel e tokens do app daquele vínculo, e reativar não os devolve; `createAdmin` com e-mail repetido falha; desativar a si mesmo e o último admin ativo → recusado; desativar admin derruba as sessões dele; `changeOwnPassword` com senha atual errada falha e, na 6ª tentativa, bloqueia; com a certa, as outras sessões caem e a atual fica; `startSupport` devolve URL do host do painel e grava só o hash; `redeemSupport` com o token certo cria sessão de suporte de 60 min e um segundo uso devolve `null`; token com 61 s devolve `null`; duas trocas simultâneas do mesmo token: uma passa; a sessão de suporte dá ator `impersonator` com `can()` de dono; alteração feita em suporte grava auditoria com o admin; admin desativado → a sessão de suporte para de valer na leitura seguinte; conta arquivada → idem; conta suspensa → suporte entra e membro comum não; `endSupport` apaga a sessão; ator que não é admin → `forbidden`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: equipe da conta, admins da plataforma e modo suporte (entrar como)`.

---

### Task 4: Métricas, sistema e auditoria (domínio)

**Files:**
- Create: `src/server/domain/platform/metrics.ts`, `src/server/domain/platform/system.ts`, `src/server/domain/platform/audit-log.ts`
- Modify: `src/server/notifications/scheduler.ts` (registra cada execução), `prisma/schema.prisma` + migração (`scheduler_runs`), `src/server/time/index.ts` (o que faltar para "dia local" e "mês local" de um fuso)
- Test: `tests/integration/platform-metrics.test.ts`, `tests/integration/platform-system.test.ts`, `tests/integration/platform-audit-log.test.ts`

**Interfaces:**
- Consumes: `usageSummary`, tabelas das fases anteriores.
- Produces:

```ts
// metrics.ts
export type Trend = { current: number; previous: number }                        // mesmo período anterior
export type Overview = { accounts: { active: number; suspended: number; archived: number; newLast30d: number }
  appointments: { today: number; month: Trend }; customers: { total: number; newMonth: Trend }
  revenueCents: { month: Trend }                                                   // soma dos atendimentos concluídos
  appUsers: { activeToday: number; activeMonth: number }                          // clientes distintos com sessão do app usada no período
  api: { requests24h: number; errors24h: number }; notifications: { pending: number; failed24h: number }
  quietAccounts: { id: string; name: string; lastActivityAt: Date | null }[] }   // ativas sem agendamento criado há 14 dias; até 10
export function getOverview(actor: PlatformAdminActor, now: Date): Promise<Overview>
export type AccountMetrics = { appointments: { today: number; next7d: number; month: Trend; byStatusMonth: Record<string, number> }; customers: { total: number; newMonth: number }; revenueCents: { month: Trend }; team: { active: number; professionals: number }; appUsers: { activeMonth: number }; lastActivityAt: Date | null }
export function getAccountMetrics(actor: PlatformAdminActor, businessId: string, now: Date): Promise<AccountMetrics>
// system.ts
export type SystemStatus = { database: { sizeBytes: number; largestTables: { name: string; bytes: number }[] }
  queue: { pending: number; oldestPendingAt: Date | null; failed24h: number; skipped24h: number }
  scheduler: { lastRuns: { kind: string; startedAt: Date; finishedAt: Date | null; ok: boolean; summary: string }[] }
  recentFailures: { at: Date; kind: string; code: string; businessName: string | null }[] }
export function getSystemStatus(actor: PlatformAdminActor, now: Date): Promise<SystemStatus>
export function retryFailedNotification(actor: PlatformAdminActor, notificationId: string, now: Date): Promise<void>
// audit-log.ts
export type AuditRow = { id: string; at: Date; actorLabel: string; action: string; businessId: string | null; businessName: string | null; targetLabel: string | null; metadata: unknown }
export function listAudit(actor: PlatformAdminActor, q: { businessId?: string; action?: string; actorType?: string; from?: Date; to?: Date; cursor?: string; limit?: number }): Promise<{ items: AuditRow[]; nextCursor: string | null }>
```

Regras: "hoje" e "mês" de cada conta são contados no fuso DELA (um agendamento às 23:30 de Manaus conta no dia local de Manaus), somando depois; `Trend.previous` é o período anterior de mesmo tamanho. Receita é a soma do valor dos agendamentos `COMPLETED` no período. `appUsers` conta clientes distintos com token de renovação emitido ou usado no período. Todas as consultas de métricas são agregações no banco (`count`/`sum`/`groupBy` ou SQL parametrizado), nunca carregam linhas para somar em memória, e `getOverview` não passa de 15 consultas. `scheduler_runs` (plataforma): `kind` (`notifications`, `cleanup`, `usage_flush`), início, fim, `ok`, resumo curto sem dado pessoal; o agendador grava uma linha por execução e a limpeza horária apaga as com mais de 14 dias. `largestTables` são as 8 maiores. `recentFailures`: avisos `FAILED` das últimas 24 h (código de `lastError`, nunca destinatário) e execuções do agendador com erro. `retryFailedNotification` volta um aviso `FAILED` para `PENDING` com tentativas zeradas, só se o agendamento ainda justificar (deixa `decide` julgar na próxima rodada) e grava auditoria. `listAudit`: mais recentes primeiro, cursor estável, `limit` até 100, intervalo máximo de 92 dias; `metadata` sai como foi gravada (já é sem segredo); `actorLabel` legível ("Admin Ana", "Dono João", "Admin Ana em suporte", "Cliente", "Sistema").

- [ ] **Step 1: Testes que falham:** com relógio fixo e duas contas em fusos diferentes (São Paulo e Manaus), um agendamento às 23:30 locais de Manaus conta no "hoje" certo e outro à 00:30 do dia seguinte não; tendência do mês compara com o mês anterior; receita soma só `COMPLETED`; `appUsers` conta cliente distinto uma vez; conta sem agendamento há 15 dias aparece em `quietAccounts` e uma arquivada não; `getAccountMetrics` de uma conta não soma nada de outra; `getSystemStatus` devolve tamanho do banco > 0, a fila com o pendente mais antigo, as últimas execuções gravadas pelo agendador e as falhas sem destinatário; `retryFailedNotification` volta para a fila e audita, e aviso que não está `FAILED` → `conflict`; `listAudit` filtra por conta, ação e período, pagina sem repetir nem pular, recusa intervalo de 93 dias; o agendador grava `scheduler_runs` com `ok: false` quando a rodada lança; ator que não é admin → `forbidden`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: métricas da plataforma, estado do sistema e consulta da auditoria`.

---

### Task 5: Base das telas do painel dev e lista de contas

**Files:**
- Create: `src/app/dev/(app)/contas/page.tsx`, `src/app/dev/(app)/_lib/{form-state.ts,action.ts}`, `src/ui/components/{Pagination,SearchBar,ConfirmDialog,StatusLamp,FormErrors}.tsx`
- Modify: `src/ui/shells/{DevShell,nav,PainelShell,ShellFrame}.tsx` (navegação nova e pendências de moldura), `src/app/dev/(app)/{layout,page}.tsx`, `src/app/dev/vitrine/page.tsx` (atrás de `requirePlatformAdmin`), `src/ui/components/index.ts`, mover `LoginForm` de `painel/` para `src/ui/` (ou `src/app/_lib/`)
- Test: `tests/unit/dev-form-state.test.ts`, `tests/unit/ui-pagination.test.tsx`, `tests/unit/ui-confirm-dialog.test.tsx`, `tests/unit/dev-nav.test.ts`

**Interfaces:**
- Consumes: Tarefas 1 a 4.
- Produces:

```ts
// _lib/form-state.ts
export type FormState<V> = { ok: boolean; message: string | null; fields: Record<string, string>; values: V }
export function formError<V>(err: unknown, values: V): FormState<V>     // DomainError → campos e mensagem; outro erro → mensagem genérica e log
// _lib/action.ts
export function adminAction<V, R>(parse: (fd: FormData) => V, run: (admin: PlatformAdminActor, v: V) => Promise<R>, done: (r: R) => FormState<V> | never): (prev: FormState<V>, fd: FormData) => Promise<FormState<V>>
```

Regras: navegação do painel dev com seis destinos: Visão geral (`/`), Contas (`/contas`), Chaves e API (`/chaves`), Sistema (`/sistema`), Auditoria (`/auditoria`), Admins (`/admins`); o item ativo usa `aria-current="page"`. `adminAction` chama `requirePlatformAdmin()` em TODA ação, converte `DomainError` em estado de formulário (nunca vaza erro interno) e, no sucesso, redireciona ou devolve mensagem. Lista de contas: busca (nome, slug, e-mail do dono), filtro por situação, paginação por cursor na URL, cada linha com situação (`StatusLamp`), dono, link de entrada copiável, e atalhos "Abrir" e "Entrar como"; estado vazio com chamada para criar a primeira conta. `ConfirmDialog` exige digitar o nome do alvo quando a ação é destrutiva e funciona sem JavaScript (cai numa página de confirmação). Pendências de moldura desta fase: `symbolUrl` aparece onde a moldura estreita não cabe o logo; a faixa de suporte não cobre a coluna fixa (o `top` considera a altura da faixa); a vitrine mostra o logo em baixo-relevo e a faixa de suporte.

- [ ] **Step 1: Testes que falham:** `formError` com `DomainError` de validação devolve os campos e mantém os valores digitados (menos senhas); com erro inesperado devolve mensagem genérica sem o texto original; `adminAction` sem sessão de admin não executa `run`; a navegação marca o destino ativo, inclusive em subpáginas (`/contas/abc` ativa Contas); `Pagination` gera os links com o cursor e preserva busca e filtro; `ConfirmDialog` só habilita o botão com o nome exato e tem rótulo acessível.
- [ ] **Step 2:** Rodar → FALHA. Implementar as bases e a lista de contas. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: base das telas do painel dev e lista de contas`.

---

### Task 6: Criar conta em etapas, com prévia ao vivo

**Files:**
- Create: `src/app/dev/(app)/contas/nova/{page.tsx,actions.ts,Wizard.tsx}`, `src/ui/components/{BrandPreview,ColorField,MaterialPicker,StepRail}.tsx`
- Test: `tests/unit/ui-brand-preview.test.tsx`, `tests/unit/ui-color-field.test.tsx`, `tests/integration/dev-create-account-action.test.ts`

**Interfaces:**
- Consumes: `createBusiness`, `updateBrand`, `setBrandImage`, `updateTerms`, `updateModules`, `updateRulesAsAdmin`, `createApiKey`, `previewTheme`, `adminAction`.
- Produces: `BrandPreview({ brand, terms, businessName })` — miniatura fiel do painel do negócio (capa no material e cor, papel, abas, uma ficha de agendamento, um botão), renderizada com os mesmos tokens de `previewTheme`; reutilizada na Tarefa 7.

Regras: sete etapas numa página só, com trilho de etapas (`StepRail`): Dados, Marca (com prévia ao lado, que atualiza a cada mudança sem ir ao servidor), Termos (com sugestões por ramo: barbearia, pet shop, clínica, estúdio — só preenchem os campos), Módulos, Regras de agenda, Dono, Chave de app. A conta só é criada no fim, numa ação só, que chama as funções de domínio em ordem; se a criação da conta passa e um passo seguinte falha, a tela leva à página da conta com o aviso do que faltou (nunca deixa conta criada invisível). O estado das etapas fica no formulário (campos ocultos), sobrevive a erro de validação e volta para a etapa do primeiro campo com erro. A prévia mostra os avisos de `previewTheme` em texto ("Ajustamos a cor do texto sobre a capa para manter a leitura"). O segredo da chave de app aparece UMA vez na tela final, com botão de copiar e o aviso de que não será mostrado de novo; nunca vai para a URL. Sem JavaScript, as etapas viram um formulário longo que funciona.

- [ ] **Step 1: Testes que falham:** `BrandPreview` aplica os tokens de `previewTheme` no elemento raiz e mostra o termo da conta ("Tosador"); `ColorField` aceita `#rrggbb`, recusa outro formato com mensagem e tem rótulo; a ação de criar com dados válidos cria conta, marca, termos, módulos, regras, dono e chave, e o estado de retorno traz o segredo uma vez; com slug duplicado devolve o erro no campo `slug` e a etapa 1; com falha simulada na chave devolve o id da conta criada e o aviso; sem sessão de admin não cria nada.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: criação de conta em etapas com prévia ao vivo da marca`.

---

### Task 7: Página da conta

**Files:**
- Create: `src/app/dev/(app)/contas/[id]/{layout.tsx,page.tsx,actions.ts}` e as abas `marca`, `termos`, `modulos`, `regras`, `equipe`, `chaves`, `auditoria` (cada uma `page.tsx`)
- Test: `tests/integration/dev-account-actions.test.ts`, `tests/unit/dev-account-tabs.test.tsx`

**Interfaces:**
- Consumes: Tarefas 1 a 6 (`getBusinessDetail`, `getAccountMetrics`, `getCustomization` e as funções de escrita, `listTeam` e afins, `listApiKeys`/`createApiKey`/`revokeApiKey`/`updateApiKeyOrigins`, `usageSummary`, `listAudit`, `startSupport`, `BrandPreview`).

Regras: cabeçalho da conta com nome, situação, link de entrada copiável, "Entrar como" (abre em nova aba) e o menu de situação (suspender, reativar, arquivar — com `ConfirmDialog` pelo nome). Abas são navegação por URL (`aria-current`). Resumo: métricas da conta e dados cadastrais editáveis (com versão; conflito mostra "Outra pessoa alterou esta conta. Recarregue para ver a versão atual." mantendo o que foi digitado). Marca: formulário com `BrandPreview` ao lado e envio de logo, símbolo, favicon e imagem de entrada (cada um com prévia e "remover"). Regras: regras de agenda, fuso (lista de fusos do Brasil no topo, busca nos demais) e avisos por tipo e canal. Equipe: membros com papel, situação, último acesso, "reenviar convite", trocar papel, desativar/reativar. Chaves: chaves da conta, criar (segredo mostrado uma vez), revogar, editar origens, e o uso de cada chave nos últimos 7 dias (requisições, erros, tempo médio, rotas mais chamadas). Auditoria: `listAudit` filtrada pela conta. A aba "Integrações" da spec fica para a Fase 5 (não há integração antes dos módulos): não crie a aba vazia.

- [ ] **Step 1: Testes que falham** (ações chamadas direto, com admin de teste): editar dados com versão antiga devolve o estado de conflito com os valores digitados; suspender com nome errado não suspende; ligar vouchers sem loja devolve o erro no campo; trocar papel do último dono devolve a mensagem do domínio; criar chave devolve o segredo uma vez e a listagem seguinte não o contém; revogar chave de OUTRA conta pelo formulário desta conta → não revoga (a ação confere que a chave é da conta da página); as abas marcam a ativa.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: página da conta no painel dev (resumo, marca, termos, módulos, regras, equipe, chaves, auditoria)`.

---

### Task 8: Visão geral, chaves e API, sistema, auditoria e admins

**Files:**
- Create: `src/app/dev/(app)/{chaves,sistema,auditoria,admins,perfil}/{page.tsx,actions.ts}`, `src/ui/components/{StatTile,Sparkline,MiniBars}.tsx`
- Modify: `src/app/dev/(app)/page.tsx` (visão geral de verdade)
- Test: `tests/unit/ui-stat-tile.test.tsx`, `tests/integration/dev-global-actions.test.ts`

**Interfaces:**
- Consumes: `getOverview`, `getSystemStatus`, `retryFailedNotification`, `listAudit`, `listApiKeys`/`createApiKey`/`revokeApiKey`, `usageSummary`, `listAdmins` e afins, `changeOwnPassword`.

Regras: Visão geral com os números de `getOverview` em mostradores do design system (contador mecânico para totais, tendência com seta e texto "12 a mais que no mês passado", nunca só cor), contas sem atividade com atalho para a conta, e a fila de avisos. Chaves e API: todas as chaves (de conta e de plataforma) com filtro, uso por chave nos últimos 7 e 30 dias, criar chave de plataforma, revogar, e o link para o OpenAPI (`areaLink('api', '/v1/openapi.json')`). Sistema: fila, falhas recentes com "tentar de novo", tamanho do banco e maiores tabelas, últimas execuções do agendador. Auditoria: filtros por conta, ação, tipo de ator e período, paginada, com o detalhe (`metadata`) recolhível. Admins: lista, criar, desativar/reativar. Perfil: nome e troca de senha. Gráficos pequenos em SVG próprio (sem biblioteca), com `role="img"`, título e resumo em texto; dinheiro em reais por `formatBrl`.

- [ ] **Step 1: Testes que falham:** `StatTile` mostra valor, rótulo e a tendência em texto (para cima, para baixo e igual) e não depende de cor; `Sparkline` tem `role="img"` e descrição; ação de criar admin com e-mail repetido devolve o erro no campo; desativar a si mesmo devolve a mensagem do domínio; trocar a senha com a atual errada devolve erro e não troca; "tentar de novo" num aviso que não falhou devolve a mensagem de conflito; revogar chave pede o nome e audita.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte e build verdes.
- [ ] **Step 3:** Commit: `feat: visão geral, chaves e API, sistema, auditoria e admins no painel dev`.

---

### Task 9: Fechamento da fase

**Files:**
- Modify: `prisma/seed*.ts` (dados que deem vida às telas: um admin extra desativado, uma conta suspensa, uso de API das últimas 48 h, execuções do agendador, um aviso com falha), `README.md` (seção curta "Painel dev": endereço local, login de demonstração, como criar o primeiro admin; arquivo em até 90 linhas), `docs/superpowers/pendencias-proximas-fases.md` (tirar da "Fase 3" o que foi resolvido), `tests/integration/seed.test.ts`

- [ ] **Step 1:** Teste do seed (os dados novos existem e rodar de novo não duplica) → FALHA. Implementar.
- [ ] **Step 2: Verificação final:** `npm run typecheck && npm run lint && npm test && npm run test:tz && npm run build`; `grep -rn "from '@/server/db/client'" src/app` → vazio; `grep -rniE "sejasans|sans (company|club|coins)|clube_sans|barber" src prisma scripts tests` → vazio; toda `page.tsx` e toda ação sob `src/app/dev/(app)` passa por `requirePlatformAdmin` (um teste estático varre a pasta).
- [ ] **Step 3:** Commit: `feat: seed e documentação do painel dev`.
