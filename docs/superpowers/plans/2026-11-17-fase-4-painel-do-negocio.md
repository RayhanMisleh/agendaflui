# AgendaFlui — Fase 4: Painel do negócio — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar ao dono e à equipe de cada negócio o painel `painel.` completo: início, agenda (dia e semana, marcar, remarcar, situação, bloqueios), clientes, equipe, serviços, relatórios e configurações, com a marca da conta.

**Architecture:** O domínio de conta (`src/server/domain/**`, com `ctx: TenantContext`) já existe desde a Fase 2A e é a única fonte de regra; esta fase acrescenta o que falta (acessos da equipe, configurações do dono, relatórios) e as telas em `src/app/painel/(app)/**`. Cada tela é componente de servidor que chama o domínio; cada formulário usa uma ação de servidor fina (`tenantAction`) que refaz o guarda de sessão e a capacidade e devolve erros por campo. O que a tela esconde por papel o servidor também recusa.

**Tech Stack:** a mesma das fases anteriores. Nenhuma dependência nova (arrastar e soltar com eventos de ponteiro nativos; CSV gerado no servidor).

**Spec:** `docs/superpowers/specs/2026-11-13-agendaflui-design.md` — seções 7, 8, 9.1, 10, 11 e 12.2. Pendências herdadas: `docs/superpowers/pendencias-proximas-fases.md`, seção "Fase 4".

## Global Constraints

- Vale tudo de `AGENTS.md`: TypeScript estrito, sem `any`; data e hora só por `src/server/time/`; `z` de `@/server/domain/errors`; domínio recebe `ctx` e usa `ctx.db` e `ctx.clock()`; textos em pt-BR, frase simples, voz ativa; nenhum domínio fixo; nenhum termo do sistema antigo; sem formatador automático; commits locais (o coordenador é quem envia ao remoto).
- Regra de negócio só em `src/server/`. Telas e ações não importam `@/server/db/client` nem `tenantDb`, e não repetem limites ou validações do domínio: importam as constantes e os esquemas dele.
- Toda página de `src/app/painel/(app)` começa por `requireTenant(<capacidade>)`; toda ação de servidor passa por `tenantAction`, que chama `requireTenant` de novo com a capacidade da ação. A tela esconde o que o papel não pode; o servidor é quem bloqueia. O profissional só vê e altera o que é dele (agenda, horários, bloqueios, relatórios próprios); clientes ele só lê.
- Ator de suporte (admin da plataforma em "entrar como") tem os poderes do dono, com duas exceções fixas: não troca senha de ninguém nem dispara redefinição de senha, e não vê segredos. A faixa de suporte aparece em todas as telas.
- Os termos da conta (profissional, cliente, pontos, clube) aparecem em todos os rótulos; nunca um termo fixo como "barbeiro" ou "cliente" onde a conta definiu outro.
- Todo horário mostrado é do fuso da conta, vindo pronto do servidor (rótulos); o navegador não faz conta de fuso nem usa `Date` para decidir dia ou hora. Entradas de data e hora são locais da conta e convertidas pelo módulo de tempo no servidor.
- Visual: a marca Agenda Flui, como está em `docs/superpowers/specs/2026-11-17-redesenho-marca-design.md` (fonte: `../branding/AgendaFlui-Marca/` e a landing em `../site/`). Onde este plano falar em fichas, carimbos, planner de papel ou divisórias de fichário, leia blocos da agenda, selos de situação, grade do dia e barra lateral da marca. Antes de desenhar tela nova, carregar a skill `frontend-design:frontend-design`; componentes novos entram na vitrine; nada de segundo estilo. Toda tela funciona a 375 px (tabelas viram cartões, formulários sobem como folha), tem foco visível, respeita `prefers-reduced-motion`, e não informa nada só por cor. Campos com 16 px no celular.
- Formulários comuns funcionam sem JavaScript; ações destrutivas pedem confirmação (podem exigir JavaScript); a agenda interativa exige JavaScript, mas tem alternativa por teclado e por menu para tudo o que o arrastar faz.
- Listas com mais de 50 itens são paginadas no servidor, com busca e filtros na URL.
- Sem testes de navegador (Playwright) e sem usar navegador: verificação por `npm run typecheck && npm run lint && npm test`, `npm run build` e `npm run smoke` (fumaça por HTTP, estendida nesta fase ao painel do negócio). Componentes com lógica têm teste com Testing Library.
- Migração nova por mudança de banco, com data posterior às existentes; nunca editar migração antiga; tabela de conta com `business_id` e FK composta; modelo classificado em `src/server/db/models.ts`.
- Não criar arquivos de documentação além dos listados.

## Review Focus

1. **Papel errado na URL**: profissional que digita o endereço da ficha de um colega, da equipe, dos relatórios gerais ou das configurações recebe "sem permissão" (ou 404), nunca os dados; o mesmo para ações chamadas direto. Testes nas Tarefas 4 a 9.
2. **Marcar em cima**: duas pessoas da equipe marcando o mesmo horário do mesmo profissional ao mesmo tempo, ou arrastando duas fichas para o mesmo lugar: uma entra, a outra recebe a mensagem com o horário livre mais próximo, e a tela se atualiza. Teste nas Tarefas 7 e 8.
3. **Virada de dia e de fuso**: conta em Manaus aberta num navegador em São Paulo; agendamento às 23:30 e bloqueio que atravessa a meia-noite aparecem no dia certo da conta, na agenda, no início e nos relatórios. Testes nas Tarefas 3 e 7.
4. **Último dono e a própria conta**: o dono não consegue se rebaixar, se desativar ou remover o último dono; trocar a própria senha derruba as outras sessões e os tokens do app; "esqueci a senha" responde igual exista o e-mail ou não. Teste na Tarefa 1.
5. **Relatório grande**: período de um ano com muitos atendimentos não carrega tudo na memória nem estoura o tempo; a exportação CSV sai em fluxo, com acentos corretos no Excel e sem permitir fórmula injetada (`=`, `+`, `-`, `@` no início de célula). Teste na Tarefa 3.

---

## Mapa de arquivos

```
src/server/domain/team/access.ts               acessos da equipe pelo dono (convidar, papel, desativar, reenviar)
src/server/auth/password-reset.ts              esqueci a senha do painel (usuários)
src/server/domain/account/profile.ts           meu perfil e minha senha
src/server/domain/settings/business-profile.ts dados do negócio, termos e logo pelo dono (com versão)
src/server/domain/reports/**                   relatórios e exportação CSV
src/server/domain/scheduling/agenda.ts         ajustes herdados (teto de linhas, resumo)
src/app/painel/(app)/**                        telas e ações do painel do negócio
src/app/painel/{esqueci-a-senha,redefinir-senha}/**   recuperação de senha
src/ui/components/**, src/ui/shells/**         componentes novos e ajustes pendentes
scripts/smoke-pages.ts                         fumaça também no painel do negócio
```

---

### Task 1: Acessos da equipe, meu perfil e recuperação de senha (domínio)

**Files:**
- Create: `src/server/domain/team/access.ts`, `src/server/auth/password-reset.ts`, `src/server/domain/account/profile.ts`, `src/server/auth/user-public.ts`, `src/server/notifications/render-password-reset.ts`
- Modify: `src/server/domain/platform/team.ts` (passa a reusar o mesmo núcleo, sem mudar o comportamento), `src/server/auth/capabilities.ts` (exceções do suporte), `prisma/schema.prisma` + migração se faltar propósito de token para redefinição
- Test: `tests/integration/team-access.test.ts`, `tests/integration/password-reset.test.ts`, `tests/integration/account-profile.test.ts`

**Interfaces:**
- Consumes: `issueInvite`/`acceptInvite`, `revokeAllFor`, `$lockKey('membership' | 'business_owners')`, `hitRateLimit`, moldura de e-mail, `TeamMember` e o núcleo de `platform/team.ts`.
- Produces:

```ts
// team/access.ts (ctx de conta; capacidade manage_team)
export function listAccess(ctx: TenantContext): Promise<TeamMember[]>
export function inviteAccess(ctx: TenantContext, i: { name: string; email: string; role: MembershipRole; professionalId?: string | null }): Promise<TeamMember>
export function changeAccessRole(ctx: TenantContext, membershipId: string, role: MembershipRole): Promise<TeamMember>
export function setAccessActive(ctx: TenantContext, membershipId: string, active: boolean): Promise<TeamMember>
export function resendAccessInvite(ctx: TenantContext, membershipId: string): Promise<void>
export function sendAccessPasswordReset(ctx: TenantContext, membershipId: string): Promise<void>   // manda o link de redefinição ao membro
// auth/user-public.ts
export function publicUsers(businessId: string, userIds: string[]): Promise<Map<string, { name: string; email: string; avatarUrl: string | null }>>
// auth/password-reset.ts (painel)
export function requestPanelPasswordReset(email: string, meta: RequestMeta, now: Date): Promise<() => Promise<void>>   // parte síncrona igual para todos; devolve a continuação
export function readPanelPasswordReset(token: string, now: Date): Promise<{ email: string } | null>
export function resetPanelPassword(i: { token: string; password: string }, meta: RequestMeta, now: Date): Promise<void>
// account/profile.ts
export function getOwnAccountProfile(ctx: TenantContext): Promise<{ name: string; email: string; avatarUrl: string | null; role: MembershipRole; professionalId: string | null }>
export function updateOwnAccountProfile(ctx: TenantContext, i: { name: string }): Promise<void>
export function changeOwnAccountPassword(ctx: TenantContext, i: { current: string; next: string }, keepSessionToken: string): Promise<void>
```

Regras: `team/access.ts` é a porta do dono e do gerente para o MESMO núcleo que `platform/team.ts` usa (último dono ativo sob trava, revogação de sessões do painel e de tokens do app ao desativar ou rebaixar, convite só para quem não tem senha, e-mail de aviso para quem já tem); extraia o núcleo para funções compartilhadas e deixe as duas portas finas. Diferenças da porta do dono: o gerente não cria, promove nem rebaixa donos (`OWNER` só por dono); ninguém altera o próprio vínculo por aqui; o suporte pode tudo o que o dono pode, exceto `sendAccessPasswordReset`. `inviteAccess` com `professionalId` liga o acesso à ficha de profissional (uma ficha tem no máximo um acesso). Trocar o nome de um usuário regrava `users.search_name`. Redefinição de senha do painel: token opaco de 32 bytes, só o hash, validade de 60 minutos, uso único por UPDATE condicional, um token vivo por usuário; a resposta de "esqueci a senha" é idêntica exista o e-mail ou não (todo o trabalho que depende do e-mail roda depois da resposta, como na conta do cliente); limite por IP e por e-mail (3 a cada 15 minutos, 6 por dia); redefinir revoga todas as sessões do painel do usuário e os tokens do app de todos os vínculos dele; usuário sem nenhum vínculo ativo não recebe e-mail. `changeOwnAccountPassword`: senha atual conferida (5 tentativas a cada 15 minutos por usuário), `passwordSchema`, nova diferente da atual, mantém a sessão atual e derruba as outras e os tokens do app. O ator de suporte recebe `forbidden` em `changeOwnAccountPassword`, `updateOwnAccountProfile` e `sendAccessPasswordReset` (não existe "eu" em suporte).

- [ ] **Step 1: Testes que falham:** dono convida gerente e profissional (convite e e-mail; usuário existente só vincula e recebe aviso); gerente tentando criar ou promover dono → `forbidden`; profissional em qualquer função → `forbidden`; rebaixar ou desativar o último dono → recusado; alterar o próprio vínculo → recusado; desativar derruba sessões do painel e tokens do app daquele vínculo e reativar não devolve; ficha de profissional com dois acessos → `conflict`; suporte convida e desativa, mas `sendAccessPasswordReset` → `forbidden`; `requestPanelPasswordReset` para e-mail existente e inexistente: mesma resposta, nenhum acesso ao banco antes da continuação, e só o existente recebe e-mail; 4º pedido em 15 minutos não envia; token usado duas vezes, vencido (61 min) e de outro usuário falham; duas redefinições simultâneas: uma passa; redefinir derruba sessões e tokens do app; `changeOwnAccountPassword` com atual errada falha e bloqueia na 6ª; com a certa mantém só a sessão atual; `publicUsers` só devolve usuários com vínculo naquela conta; conta B nunca enxerga membro de A.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: acessos da equipe pelo dono, meu perfil e recuperação de senha do painel`.

---

### Task 2: Configurações do dono (domínio)

**Files:**
- Create: `src/server/domain/settings/business-profile.ts`
- Modify: `src/server/domain/settings/{scheduling-rules,notification-settings,closures}.ts`, `src/server/domain/platform/customization.ts` (reusa as mesmas funções; sem caminho paralelo), `src/server/domain/team/time-blocks.ts`, `prisma/schema.prisma` + migração (`version` em `business_settings` e `business_modules`)
- Test: `tests/integration/business-profile.test.ts`, `tests/integration/settings-versions.test.ts`, `tests/integration/closures-view.test.ts`

**Interfaces:**
- Produces:

```ts
// settings/business-profile.ts (capacidade manage_account para dados e logo; manage_settings para termos)
export type BusinessProfile = { name: string; contactEmail: string | null; contactPhone: string | null; phoneLabel: string | null; timeZone: string; entryUrl: string; logoUrl: string | null; version: number }
export function getBusinessProfile(ctx: TenantContext): Promise<BusinessProfile>
export function updateBusinessProfile(ctx: TenantContext, version: number, i: { name: string; contactEmail: string | null; contactPhone: string | null }): Promise<BusinessProfile>
export function setBusinessLogo(ctx: TenantContext, file: { bytes: Uint8Array } | null): Promise<BusinessProfile>
export function getTerms(ctx: TenantContext): Promise<{ terms: Terms; version: number }>
export function updateTermsAsOwner(ctx: TenantContext, version: number, i: Terms): Promise<{ terms: Terms; version: number }>
// settings/scheduling-rules.ts e notification-settings.ts ganham versão
export function getSchedulingRules(ctx: TenantContext): Promise<SchedulingRules & { version: number }>
export function updateSchedulingRules(ctx: TenantContext, i: Partial<SchedulingRules>, version?: number): Promise<SchedulingRules & { version: number }>
// settings/closures.ts
export type ClosureView = { id: string; startDate: string; endDate: string; label: string; reason?: string | null }   // `reason` só para quem tem manage_settings
export function listClosuresFor(ctx: TenantContext, q: { from: string; to: string }): Promise<ClosureView[]>
export function previewClosure(ctx: TenantContext, i: { startDate: string; endDate: string }): Promise<{ affectedAppointments: number }>
```

Regras: o dono muda nome de exibição, contato e logo; cor, material, papel, fontes, módulos, fuso e identificador (slug) continuam só do painel dev (o domínio recusa). Termos pelo dono usam o MESMO esquema e a mesma gravação de `updateTerms` da plataforma; idem logo e `setBrandImage`. Versão: `business_settings` e `business_modules` ganham `version`; toda gravação de termos, regras e avisos (pelo dono ou pelo admin) é UPDATE condicional pela versão quando ela é informada (o painel sempre informa; `conflict` com `stale_version`), e `updateRulesAsAdmin` passa a chamar `updateSchedulingRules` (um caminho só). Fechamentos: `listClosuresFor` é a única leitura usada por telas e rotas, com `reason` só para quem pode gerenciar; `previewClosure` e a prévia equivalente de bloqueio (`previewTimeBlock`) dizem quantos agendamentos ativos caem no intervalo, para a tela avisar antes de confirmar. Telefone de contato: normalizado como os de cliente; número estrangeiro sem `+` devolve erro que orienta ("Comece com + e o código do país").

- [ ] **Step 1: Testes que falham:** dono muda nome e contato e a versão sobe; versão antiga → `conflict`; gerente em `updateBusinessProfile` → `forbidden` e em termos → permitido; profissional → `forbidden` em tudo; tentativa de mudar slug, fuso ou cor por estas funções não existe no tipo e é recusada em execução; logo trocado apaga o anterior; termos pelo dono e pelo admin gravam no mesmo lugar e uma gravação com versão antiga, vinda de qualquer um dos dois, falha; regras e avisos idem; `listClosuresFor` devolve `reason` ao gerente e não ao profissional; `previewClosure` conta só agendamentos `PENDING`/`CONFIRMED` no intervalo, no fuso da conta; bloqueio idem; telefone `11987654321` grava e `4915112345678` sem `+` orienta.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: configurações do dono (dados, termos, logo) com versão e fechamentos por ator`.

---

### Task 3: Relatórios e ajustes da agenda (domínio)

**Files:**
- Create: `src/server/domain/reports/{summary,breakdowns,detail,csv}.ts`
- Modify: `src/server/domain/scheduling/agenda.ts`, `src/server/time/index.ts` (o que faltar para períodos locais), `prisma/schema.prisma` + migração se algum índice faltar
- Test: `tests/integration/reports.test.ts`, `tests/unit/reports-csv.test.ts`, `tests/integration/agenda-limits.test.ts`

**Interfaces:**
- Produces:

```ts
export type ReportRange = { from: string; to: string }            // datas locais da conta, inclusive; no máximo 366 dias
export type ReportFilter = ReportRange & { professionalId?: string; serviceId?: string }
export type ReportSummary = { revenueCents: number; completed: number; canceled: number; noShow: number; averageTicketCents: number; commissionCents: number | null; byDay: { date: string; revenueCents: number; completed: number }[] }
export function getReportSummary(ctx: TenantContext, f: ReportFilter): Promise<ReportSummary>
export function getReportByProfessional(ctx: TenantContext, f: ReportFilter): Promise<{ professionalId: string; name: string; completed: number; revenueCents: number; commissionCents: number | null }[]>
export function getReportByService(ctx: TenantContext, f: ReportFilter): Promise<{ serviceId: string; name: string; count: number; revenueCents: number }[]>
export function listReportRows(ctx: TenantContext, f: ReportFilter & { cursor?: string; limit?: number }): Promise<{ items: ReportRow[]; nextCursor: string | null }>
export function reportCsv(ctx: TenantContext, f: ReportFilter): AsyncIterable<string>   // linhas já codificadas, com BOM na primeira
export function csvCell(value: string | number | null): string
```

Regras: tudo agregado no banco, por períodos locais do fuso da conta (`[início do dia de from, fim do dia de to)`), pelo término do atendimento; receita e comissão só de `COMPLETED`; ticket médio = receita ÷ concluídos (0 quando não há). Capacidades: dono e gerente veem tudo; o profissional só os PRÓPRIOS números (o domínio força `professionalId` = a ficha dele e recusa outro com `forbidden`), e comissão só aparece para quem pode ver comissão (dono, gerente, e o profissional na própria). `listReportRows`: cursor estável, `limit` até 100. CSV: separador `;`, BOM UTF-8, `\r\n`, aspas dobradas, datas e horas em rótulo local, dinheiro com vírgula decimal sem símbolo, e toda célula de texto que começa com `=`, `+`, `-`, `@`, tabulação ou retorno de carro recebe um apóstrofo na frente; gerado em fluxo, lendo em páginas de 500, sem montar o arquivo na memória. Agenda (pendências): `getAgenda` com teto de linhas por consulta e erro claro quando o período pedido passa de 31 dias; o resumo do dia desconta bloqueios dos minutos de trabalho e usa o mesmo conjunto de profissionais que a agenda mostra.

- [ ] **Step 1: Testes que falham:** conta em Manaus com atendimento concluído às 23:30 locais entra no dia local certo e outro à 00:30 do dia seguinte fica fora do período; receita e comissão só de concluídos; ticket médio com zero concluídos é 0; filtro por profissional e por serviço; profissional pedindo o relatório de um colega → `forbidden` e o próprio vem sem os dos outros; comissão `null` para quem não pode ver; intervalo de 367 dias → `validation`; `listReportRows` pagina sem repetir nem pular; conta B fora dos números de A; `csvCell` com `=SOMA(A1)`, `+55`, `-1`, `@x`, aspas, `;` e quebra de linha; o CSV de 1.200 linhas sai em mais de um pedaço, começa com BOM e tem 1.201 linhas; `getAgenda` com 32 dias → `validation`; resumo do dia com bloqueio de 2 horas desconta 120 minutos; profissional inativo com atendimento no dia aparece nos dois lugares.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte verde.
- [ ] **Step 3:** Commit: `feat: relatórios do negócio com exportação CSV e ajustes da agenda`.

---

### Task 4: Base das telas do painel do negócio e Início

**Files:**
- Create: `src/app/painel/(app)/_lib/{action.ts,params.ts,campos.ts}`, `src/app/painel/(app)/inicio/**` (ou a própria `page.tsx`), `src/ui/components/{Sheet,PhoneLink,EmptyHint}.tsx`
- Modify: `src/ui/shells/{PainelShell,ShellNav,nav}.ts*`, `src/app/painel/(app)/{layout,page,PainelFrame}.tsx`, `src/ui/components/{DataList,Toast,Tabs,Dialog}.tsx` e estilos (pendências), `scripts/smoke-pages.ts` (sessão temporária de membro e páginas do painel do negócio), mover o que for comum de `src/app/dev/(app)/_lib` para `src/app/_lib`
- Test: `tests/unit/painel-action.test.ts`, `tests/unit/painel-nav.test.ts`, `tests/unit/ui-sheet.test.tsx`, `tests/unit/ui-datalist.test.tsx`, `tests/integration/painel-home.test.ts`

**Interfaces:**
- Produces:

```ts
// _lib/action.ts
export function tenantAction<V, R>(capability: Capability | null, parse: (fd: FormData) => V, run: (ctx: TenantContext, v: V) => Promise<R>, done: (r: R, v: V) => FormState<V>): (prev: FormState<V>, fd: FormData) => Promise<FormState<V>>
// nav
export function painelNav(ctx: { can(c: Capability): boolean; modules: Modules; terms: Terms }): { href: string; label: string; icon: string }[]
```

Regras: `FormState`, `formError` e os ajudantes de campos passam a ser compartilhados pelos dois painéis (um lugar só). `tenantAction` chama `requireTenant(capability)` em toda execução. Navegação em divisórias de fichário: Início, Agenda, Clientes (com o termo da conta), Equipe, Serviços, Relatórios, Configurações — cada uma só para quem tem a capacidade; módulos desligados não aparecem (os módulos são da Fase 5: não crie divisórias para eles). No celular a navegação vira barra na base. Início: os próximos atendimentos de hoje (do profissional, ou de todos para dono e gerente), ocupação do dia, contadores do período (hoje e mês) e atalhos para marcar e bloquear; estado vazio útil. Pendências de componentes desta fase: `DataList` com limite tabela/cartões por instância e sem renderizar a célula duas vezes; `Toast` com uma região viva só e acima de diálogos; `Tabs` de navegação com `aria-current` e pista de rolagem a 375 px; `Dialog` não captura o Esc de filhos; título sem `h2` dentro de `h2`; papel e termos da conta calculados num lugar só. `Sheet`: folha que sobe da base no celular e vira diálogo lateral no computador, com foco preso e fechamento por Esc. Fumaça: o script passa a criar também uma sessão temporária de membro (dono da conta de demonstração) e a pedir as páginas do painel do negócio no host do painel.

- [ ] **Step 1: Testes que falham:** `tenantAction` sem sessão não executa; com papel sem a capacidade devolve "sem permissão" sem chamar `run`; a navegação do profissional não tem Equipe, Relatórios gerais nem Configurações do negócio, e a do gerente não tem dados da conta; o rótulo usa o termo da conta ("Tutores"); `Sheet` prende o foco e fecha com Esc; `DataList` renderiza cada célula uma vez; o Início do profissional só traz os atendimentos dele e o do dono traz os de todos, no dia local de Manaus.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: base das telas do painel do negócio e início`.

---

### Task 5: Serviços e clientes

**Files:**
- Create: `src/app/painel/(app)/servicos/**`, `src/app/painel/(app)/clientes/**` (lista, `novo`, `[id]`), `src/ui/components/{MoneyField,DurationField}.tsx`
- Test: `tests/integration/painel-services-actions.test.ts`, `tests/integration/painel-customers-actions.test.ts`, `tests/unit/ui-money-field.test.tsx`

**Interfaces:**
- Consumes: domínio de catálogo e de clientes da Fase 2A (`listServices`, criar, editar, ativar, ordenar; `listCustomers`, `getCustomer`, criar, editar, arquivar, anonimizar; `listCustomerAppointments`), `requestPasswordReset` da conta do cliente, `tenantAction`.

Regras: Serviços: lista ordenável (botões subir/descer, com a ordem gravada de forma segura a duas pessoas ordenando ao mesmo tempo), nome, ícone de uma lista do design system, preço (campo de dinheiro em reais que envia centavos), duração (múltiplos da grade da conta), pontos e só-para-clube (visíveis só com o módulo de fidelidade ligado), ativo; arquivar com confirmação. Clientes: lista com busca sem acento, filtros (ativos, arquivados, do clube quando o módulo existir) e paginação na URL; ficha com dados, observações internas (só equipe), próximos e histórico de atendimentos paginado, contato rápido (ligar, e-mail, WhatsApp com `https://wa.me/<número>`), criar e editar (telefone com a dica do `+` para número estrangeiro), enviar redefinição de senha do app (só se o cliente tem conta no app; não disponível ao suporte), arquivar e anonimizar (anonimizar com confirmação pelo nome e aviso do que é apagado). O profissional lê clientes e não vê os botões de escrita (e as ações recusam).

- [ ] **Step 1: Testes que falham** (ações chamadas direto): criar serviço com preço "35,90" grava 3590 centavos; duração fora da grade devolve erro no campo; duas reordenações simultâneas terminam com ordem sem repetição; profissional criando serviço ou cliente → "sem permissão"; busca "joao" acha "João"; cliente de outra conta pelo id → não encontrado; anonimizar com nome errado não anonimiza; redefinição de senha por suporte → recusada; `MoneyField` aceita vírgula e ponto e recusa texto.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: telas de serviços e de clientes no painel do negócio`.

---

### Task 6: Equipe

**Files:**
- Create: `src/app/painel/(app)/equipe/**` (lista, `novo`, `[id]` com abas dados, serviços, expediente, bloqueios, acesso), `src/ui/components/{WeekScheduleEditor,AvatarUpload}.tsx`
- Test: `tests/integration/painel-team-actions.test.ts`, `tests/unit/ui-week-schedule-editor.test.tsx`

**Interfaces:**
- Consumes: domínio de equipe da Fase 2A (profissionais, serviços que faz, comissão, foto, expediente, bloqueios), `team/access.ts` (Tarefa 1), `previewTimeBlock` (Tarefa 2), rota de envio de imagem no padrão da usada no painel dev.

Regras: lista de profissionais (com o termo da conta) com foto, serviços, situação e papel do acesso; ficha com: dados e comissão (comissão só para dono e gerente), serviços que faz, expediente semanal (editor por dia com faixas `HH:mm`, copiar um dia para os outros, erro por faixa), bloqueios (lista e criação em data e hora locais, com aviso de quantos agendamentos caem no intervalo antes de confirmar) e acesso (convidar, papel, desativar, reenviar convite, enviar redefinição de senha). O profissional abre só a PRÓPRIA ficha, e nela só expediente, bloqueios e foto. Envio de foto por rota própria autenticada (multipart, limite de tamanho, origem conferida), como as imagens da marca. Remover profissional arquiva a ficha (com confirmação) e desativa o acesso ligado.

- [ ] **Step 1: Testes que falham:** profissional abrindo a ficha de um colega → sem permissão; alterando o próprio expediente → permitido; expediente com faixa invertida devolve o erro na faixa certa (`MONDAY.0.end`); bloqueio que atinge 2 agendamentos devolve a contagem na prévia e só grava depois de confirmado; comissão alterada por gerente grava e por profissional é recusada; convidar acesso para a ficha cria o vínculo ligado; desativar acesso pelo dono derruba a sessão; rota de foto sem sessão ou com outra origem recusada; `WeekScheduleEditor` copia segunda para os outros dias e serializa `HH:mm`.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: tela de equipe no painel do negócio (fichas, expediente, bloqueios e acessos)`.

---

### Task 7: Agenda — dia e semana

**Files:**
- Create: `src/app/painel/(app)/agenda/**` (página, ações, `BookingSheet`, `AppointmentSheet`, `BlockSheet`), `src/ui/components/{PlannerDay,PlannerWeek,AppointmentSlip,TimeRail}.tsx`, `src/server/domain/scheduling/agenda-layout.ts`
- Test: `tests/unit/agenda-layout.test.ts`, `tests/unit/ui-planner-day.test.tsx`, `tests/integration/painel-agenda-actions.test.ts`

**Interfaces:**
- Consumes: `getAgenda`, `getDaySummary`, `getAvailability`, `listAvailableDays`, `bookAppointment`, `confirmAppointment`, `completeAppointment`, `markNoShow`, `undoOutcome`, `cancelAppointment`, `adjustAppointment`, `notifyProfessionalFreeEarly`, bloqueios, `listClosuresFor`.
- Produces:

```ts
// agenda-layout.ts (puro, no servidor): posição de cada ficha na página do dia
export type SlipBox = { id: string; topMin: number; heightMin: number; lane: number; lanes: number }
export function layoutDay(items: { id: string; startMin: number; endMin: number }[], dayStartMin: number, dayEndMin: number): SlipBox[]
```

Regras: a URL define a visão (`?visao=dia|semana&data=AAAA-MM-DD&profissional=<id>|todos`); "hoje" vem do servidor, no fuso da conta. Dia: página de planner com as horas na margem (`TimeRail`), uma coluna por profissional (todos lado a lado para dono e gerente; o profissional vê só a própria), cada agendamento uma ficha (`AppointmentSlip`) com altura proporcional à duração, carimbo da situação, nome do cliente, serviços e horário em texto; bloqueios e fechamentos hachurados com rótulo; fichas sobrepostas dividem a largura (`layoutDay`). Semana: sete colunas com as fichas compactas. A 375 px: uma coluna por vez, com seletor de profissional e de dia. Ações (em folhas `Sheet`): marcar (cliente por busca ou cadastro rápido, serviços, profissional, dia e horário vindos de `getAvailability`; a equipe pode marcar fora da grade como o domínio permite, com aviso), abrir a ficha (situação: confirmar, concluir, faltou, desfazer, cancelar com motivo; ajustar serviços, valor e observações; "já estou livre"), criar bloqueio. Cada ação revalida a página; erro de conflito mostra o horário livre mais próximo que o domínio devolve e oferece usá-lo. Tudo o que a tela mostra de hora é rótulo pronto do servidor; o componente posiciona por minutos desde o início do dia local que o servidor informa.

- [ ] **Step 1: Testes que falham:** `layoutDay` com fichas que se sobrepõem em cadeia dá faixas sem colisão e alturas exatas; ficha que passa do fim do dia é cortada no limite; conta em Manaus: `?data=` de hoje é o dia local e um agendamento às 23:30 aparece nele; profissional pedindo `?profissional=<colega>` recebe a própria agenda (ou sem permissão), nunca a do colega; duas marcações simultâneas no mesmo horário: uma devolve o estado de conflito com `nearest`; concluir antes do início devolve a mensagem do domínio; "já estou livre" duas vezes gera um aviso só; bloqueio criado aparece hachurado; `PlannerDay` tem cada ficha como botão com nome acessível ("14:00, Rex, Banho, Confirmado") e navegação por teclado entre fichas.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: agenda do dia e da semana no painel do negócio`.

---

### Task 8: Agenda — remarcar arrastando

**Files:**
- Create: `src/ui/components/planner/{use-drag-reschedule.ts,DropPreview.tsx}`, `src/app/painel/(app)/agenda/RescheduleSheet.tsx`
- Modify: `src/ui/components/{PlannerDay,PlannerWeek,AppointmentSlip}.tsx`, ações da agenda
- Test: `tests/unit/drag-reschedule.test.ts`, `tests/unit/ui-planner-drag.test.tsx`, `tests/integration/painel-reschedule-action.test.ts`

**Interfaces:**
- Consumes: `rescheduleAppointment`, `getAvailability`, a grade (`slotStepMin`) da conta.
- Produces: `snapToStep(minutes: number, step: number): number`; `dropTarget(pointer: { x: number; y: number }, columns: DOMRectLike[], dayStartMin: number, pxPerMin: number, step: number): { professionalIndex: number; startMin: number } | null` (puras, testáveis sem navegador).

Regras: no computador, arrastar a ficha (eventos de ponteiro) para outro horário ou outra coluna mostra a prévia encaixada na grade da conta e, ao soltar, pede confirmação curta ("Remarcar Rex para 15:30 com Ana?") antes de chamar `rescheduleAppointment`; conflito devolve a ficha ao lugar e mostra o horário livre mais próximo. Só fichas `PENDING`/`CONFIRMED` arrastam; o profissional só arrasta as próprias e só dentro da própria coluna. Alternativa completa sem arrastar: "Remarcar" na folha da ficha abre `RescheduleSheet` (dia e horário pela disponibilidade), e pelo teclado a ficha em foco move com as setas (um passo da grade por tecla, Enter confirma, Esc cancela). No toque (celular) não há arrastar: só a folha. `prefers-reduced-motion` tira a animação da prévia. O horário enviado ao servidor é dia local + minutos locais; o servidor converte.

- [ ] **Step 1: Testes que falham:** `snapToStep(617, 15)` é 615 e nunca sai do dia; `dropTarget` fora de qualquer coluna é `null` e no limite entre duas escolhe a do ponteiro; ação de remarcar em cima de outro agendamento devolve conflito com `nearest` e não muda nada; remarcar ficha `COMPLETED` é recusado; profissional remarcando ficha de colega → sem permissão; duas pessoas soltando duas fichas no mesmo horário: uma passa; pelo teclado, três setas para baixo e Enter chamam a ação com `+3 × grade` minutos; Esc não chama.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: remarcar arrastando na agenda, com alternativa por teclado e por folha`.

---

### Task 9: Relatórios, configurações e recuperação de senha (telas)

**Files:**
- Create: `src/app/painel/(app)/relatorios/**` (página e `exportar/route.ts`), `src/app/painel/(app)/configuracoes/**` (negócio, agenda, fechamentos, avisos, termos, perfil), `src/app/painel/{esqueci-a-senha,redefinir-senha/[token]}/**`, `src/ui/components/{DateRangeField,BarList}.tsx`
- Test: `tests/integration/painel-reports-route.test.ts`, `tests/integration/painel-settings-actions.test.ts`, `tests/integration/painel-password-reset-actions.test.ts`

**Interfaces:**
- Consumes: Tarefas 1, 2 e 3; `getSchedulingRules`/`updateSchedulingRules`, avisos, fechamentos.

Regras: Relatórios: período na URL (atalhos hoje, 7 dias, mês, mês passado; datas locais), filtros por profissional e serviço, resumo com contadores, receita por dia (`BarList` em SVG com descrição em texto), por profissional e por serviço, lista detalhada paginada, e "Exportar CSV" por rota GET autenticada (`requireTenant`, mesma capacidade e mesmos filtros; resposta em fluxo com `Content-Disposition` e nome com o período; sem cache). O profissional vê só os próprios números, sem o filtro de profissional. Configurações, com as divisões por capacidade: Negócio (nome, contato, logo, link de entrada copiável — dono), Agenda (regras, com os limites vindos do domínio — dono e gerente), Fechamentos (lista, criar com prévia de afetados, remover), Avisos (matriz tipo × canal a partir do domínio), Termos, Meu perfil (nome e senha — todos; indisponível em suporte). Conflito de versão mantém o digitado e orienta a recarregar. Esqueci a senha: link na tela de entrada; formulário de e-mail que sempre responde "Se houver uma conta com este e-mail, enviamos as instruções"; tela de redefinir com o token (inválido ou vencido → mensagem com o que fazer), que funciona sem JavaScript e a 375 px, com a marca AgendaFlui.

- [ ] **Step 1: Testes que falham:** a rota de CSV sem sessão → redireciona para a entrada sem gerar nada; profissional exportando com `?profissional=<colega>` recebe só os próprios; o corpo começa com BOM e o cabeçalho tem o nome com o período; período de 367 dias mostra mensagem; salvar regras com versão antiga devolve conflito com o digitado; gerente em Negócio → sem permissão; criar fechamento com agendamentos no intervalo exige a confirmação da prévia; perfil em suporte → indisponível; "esqueci a senha" devolve o mesmo estado para e-mail existente e inexistente; redefinir com token usado devolve a mensagem de link inválido.
- [ ] **Step 2:** Rodar → FALHA. Implementar. Suíte, build e fumaça verdes.
- [ ] **Step 3:** Commit: `feat: relatórios, configurações e recuperação de senha no painel do negócio`.

---

### Task 10: Fechamento da fase

**Files:**
- Modify: `prisma/seed*.ts` (o que faltar para as telas terem vida: uma semana de agenda variada em cada conta de demonstração, um bloqueio, um fechamento, um cliente arquivado), `README.md` (seção curta "Painel do negócio", arquivo em até 95 linhas), `docs/superpowers/pendencias-proximas-fases.md`, `tests/unit/painel-guards.test.ts`, `tests/integration/seed.test.ts`

- [ ] **Step 1:** Teste estático: toda `page.tsx` sob `src/app/painel/(app)` chama `requireTenant`, toda ação exportada passa por `tenantAction` e todo `route.ts` chama `requireTenant` (exceções declaradas com motivo); teste do seed. → FALHA. Implementar.
- [ ] **Step 2: Verificação final:** `npm run typecheck && npm run lint && npm test && npm run test:tz && npm run build && npm run smoke`; `grep -rn "from '@/server/db/client'" src/app` → vazio; `grep -rniE "sejasans|sans (company|club|coins)|clube_sans|barber" src prisma scripts tests` → vazio.
- [ ] **Step 3:** Commit: `feat: seed e documentação do painel do negócio`.
