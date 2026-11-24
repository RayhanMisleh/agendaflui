# Fase 3 — Área do cliente na web — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/<slug>/**` vira a área do cliente completa, com a marca da loja: página pública da loja, quiz do pet, Início, Agendar, Meus horários, Meus pets, Prêmios, Loja e o que é da conta na loja — pronta para o dono conferir no celular.

**Architecture:** Toda página e toda ação de `src/app/app/[slug]/**` resolve a visita (`resolveStoreVisit`: loja aberta? pessoa entrada? cliente ligado e ativo daquela loja?) e só então chama o domínio com um `TenantContext` de ator `customer` relido a cada chamada; nada confia no slug, em ids do formulário nem em parâmetros amarrados. O domínio existente (agenda do cliente, prazo de mudança, fidelidade, banners, loja, Mercado Pago, endereços) é reaproveitado; o que falta para o cliente (vitrine pública, Início, remarcar sem bater em si mesmo, `.ics`, excluir conta na loja, conferir pagamento na volta) entra como funções novas com testes de integração. As telas são componentes de servidor; os dois fluxos de várias etapas (quiz e agendar) são componentes de cliente dirigidos por redutores puros testados com testing-library.

**Tech Stack:** Next.js 16 (App Router, server actions, `params` como `Promise`), React 19 (`useActionState`, `ViewTransition`), TypeScript estrito, Prisma 7, Vitest (Postgres embutido + jsdom/testing-library), lucide-react, CSS próprio `af-*`. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-23-app-unico-pet-design.md` (manda em tudo; seções "Área do cliente", "Pessoa, papéis e sessão", "Qualidade, visual e movimento", "Nicho pet shop"). Regras: `AGENTS.md`. Travas: `docs/ARQUITETURA.md`. Mapa do código: `.superpowers/codemap-2026-11-23.md` (fatos de antes das fases 1–2).

**Pré-requisito — fases 1 e 2 já mescladas.** Este plano usa, com os nomes exatos dos planos `docs/superpowers/plans/2026-11-23-fase1-base-app-unico.md` e `docs/superpowers/plans/2026-11-24-fase2-pet-agenda.md`: `APP_COOKIE`, `getPersonSession`, `readPersonSession`, `requirePerson`, `setSessionStore`, `destinationFor`, `destinationPath`, `findOpenStore`/`StoreRef`, `storeRelation`, `joinStore`, `lockUserAccess`, `revokeUserAccess`, `GoogleIntent`, `handleGoogleCallback`, `LojaIndisponivel`, `UsarMinhaConta`, `AbasEntrada`, `AccountShell`, `pointsText`, `startCheckout(ctx, orderId, { backPath })`, `getNotificationPreferences`/`updateNotificationPreferences` (só e-mail), `anonymizeCustomer` (já desliga a pessoa); `NICHES`, `variantDef`, `getNicheSettings`, `listMyPets`, `getPet`, `createPet`, `updatePet`, `archivePet`, `restorePet`, `setPetPhoto`, `PetView`, `PetInput`, `MAX_ACTIVE_PETS`, `petAgeLabel`, `listServicesForPet`, `fromPrice`, `ServiceView.pricingMode/prices`, `getAvailability`/`listAvailableDays` com `petId`, `BookInput.petId`, `AppointmentView.pet`, `PetIllustration`, `PetCard`, `PetTypePicker`. Se um nome tiver mudado na execução, o executor acha o equivalente (`rg`) e segue; nada aqui recria o que as fases 1–2 entregam.

## Global Constraints

Copiado da spec (literal):
- "Regras do projeto (`AGENTS.md`): domínio só em `src/server/`, `tenantDb`, `ctx.clock()`, `z` de `@/server/domain/errors`, tempo por `src/server/time/`, travas por `$lockKey` na ordem de `docs/ARQUITETURA.md`, segredos só por leitor restrito, `requireModule`, tabela nova classificada em `models.ts`, sem `any`."
- "Verificação: `npm run typecheck && npm run lint && npm test && npm run build`. Sem testes de navegador (o dono confere)."
- "ações e páginas de `/painel/**` sempre reconferem o vínculo de equipe e as de `/[slug]/**` o vínculo de cliente com aquela loja (nada confia na URL sozinha)."
- "Mobile primeiro, com a marca da loja (logo, nome, cor primária com contraste garantido, como `storePalette` do app) e o "feito com Agenda Flui" discreto. Módulo desligado some do menu. Navegação inferior no celular: Início, Agendar, Horários, Pets, Mais (Prêmios, Loja, Minha conta)."
- "Só abrir `/<slug>` com sessão não torna ninguém cliente: a página da loja mostra "Usar minha conta nesta loja" (com o que será compartilhado: nome, e-mail, telefone)."
- "A loja suspensa ou inexistente mostra a página "Loja indisponível", nunca erro cru."
- "Com gatos desligados: o quiz não pergunta espécie (é cão); o cliente vê seus gatos em Meus pets com "A loja não atende gatos no momento" e não consegue agendar para eles"
- "Movimento com propósito: transição entre páginas (View Transitions já existentes), entre perguntas do quiz (deslizar + leve escala), seleção de cartões (porte, serviço, horário) com resposta ao toque, contador e barra de progresso, sucesso do agendamento com um momento de celebração, esqueletos em todo carregamento. Só `transform`/`opacity`; tudo desligado com `prefers-reduced-motion`."
- "Toda tela com estado vazio que convida à ação, erro que diz o que fazer, carregamento, foco visível e funcionamento a partir de 360 px de largura."
- "Ilustrações próprias simples (SVG em traço, no estilo dos ícones Lucide) para portes, espécies e estados vazios."
- Anti-metas: "Cliente ver ou mexer em dado de outra loja ou de outro cliente; cliente ver encaixe ou dado interno." / "Tela crua, sem estado vazio, sem carregamento, sem resposta ao toque; animação que atrapalha ou ignora `prefers-reduced-motion`." / "Texto com "Tutor", "Tosador", "Patinhas" ou termo de outro ramo; rastro de "API do app" nas telas."
- Voz: "voz da marca: curta, verbo na frente, "você"". Termos fixos: "Profissional/Profissionais", "Cliente/Clientes", "Pontos", "Clube".
- Portes: "Pequeno até 10 kg; Médio 10 a 25 kg; Grande 25 a 45 kg; Gigante acima de 45 kg. Gato tem uma variante só."

Copiado do `AGENTS.md` (Regras):
- "Regra de negócio só em `src/server/`." / "Dados de conta só por `tenantDb`; o cliente Prisma cru (`@/server/db/client`) fica restrito às pastas liberadas no ESLint." / "Código de domínio (`src/server/domain/**`) recebe `ctx` e usa `ctx.db` e `ctx.clock()`; nunca o cliente Prisma cru nem `new Date()`." / "Esquemas de validação importam `z` de `@/server/domain/errors`, nunca de `zod`." / "Data e hora só por `src/server/time/`." / "Travas de concorrência só pela função única `$lockKey` (...), na ordem descrita em `docs/ARQUITETURA.md`." / "Segredos de integração só pelo leitor restrito `domain/platform/integration-secrets.ts` (só `domain/store/**` importa ...)." / "Módulo opcional: toda função de domínio chama `requireModule` (`module_disabled`)." / "Hosts só por `hostConfigFromEnv` (`src/server/hosts.ts`)." / "Sem `any` e sem `@ts-ignore`."
- "This is NOT the Next.js you know": antes de escrever rota, layout, `loading`, `error`, `not-found`, ação ou rota de arquivo, leia o guia correspondente em `node_modules/next/dist/docs/`.

Desta fase:
- Pasta fixa: tudo em `src/app/app/[slug]/**` (URL `/<slug>/**`); nenhuma pasta nova de primeiro nível em `src/app/app/` (o teste de nomes reservados da fase 1 continua verde).
- Sem migração nesta fase (nenhuma tabela nova). Se uma tarefa achar que precisa, pare e registre: é decisão do coordenador.
- Interface pronta para produção: kit `af-*`, tokens de `tokens.css`, `loading.tsx` com esqueleto em toda rota com dado, erro com `role="alert"` que diz o que fazer, botão com `loading` no envio, alvo de toque ≥ 44 px, sem largura fixa (confere a 360 px), foco visível.
- Sem Playwright/e2e: não rode nem escreva.
- Verificação por grupo: G1–G5 terminam com `npm run typecheck` + os arquivos de teste tocados (`npx vitest run <arquivos>`); G6 roda a verificação completa.
- Commits locais por tarefa, em português (`tipo: descrição`), terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Sem push. Não commitar o bloco gerado pelo `next dev` no `AGENTS.md`.

## Review Focus

1. **Outra loja:** pessoa cliente da loja A abre `/<B>/horarios/<id de A>`, envia ações de `/<B>` com ids de A (agendamento, pet, pedido) ou chega a `/<B>` com a sessão lembrando A → em B ela é só visitante (cartão "Usar minha conta"), as ações devolvem "não encontrado" e nada de A aparece. Testes na Tarefa 1 (`resolveStoreVisit`) e na Tarefa 13 (`cancelarHorario` com id de A pelo slug de B).
2. **Outro cliente da mesma loja:** pet, agendamento, pedido, endereço ou resgate de outro cliente usado em marcar, cancelar, remarcar, `.ics`, pagar, cotar frete ou cancelar resgate → "não encontrado" e nada muda. Testes nas Tarefas 11, 13, 14 e 16.
3. **Remarcar para perto do próprio horário:** Thor 14:00–15:00; remarcar para 14:30 aparece entre os horários livres e grava; o agendamento de outro cliente continua bloqueando. Teste na Tarefa 3.
4. **Horário tomado entre escolher e confirmar, e toque duplo:** o segundo cliente recebe "Esse horário acabou de ser ocupado." com sugestões, o fluxo volta ao passo do horário mantendo pet, serviços e profissional; a mesma chave enviada duas vezes grava um agendamento só. Testes nas Tarefas 10 (redutor) e 11 (ação).
5. **Situação muda com a página aberta:** cancelar depois do prazo → recusa com o prazo e o telefone da loja; cliente arquivado pela equipe entre abrir a página e tocar → a ação seguinte leva à loja com "Sua conta nesta loja está desativada. Fale com a loja." e não mostra dado. Testes nas Tarefas 13 e 1.

## Decisões desta fase (onde a spec cala)

- Início mora em `/<slug>` (a mesma URL da página pública): visitante vê a loja, cliente vê o Início. Rotas: `/<slug>/agendar`, `/horarios`, `/pets`, `/premios`, `/loja`, `/mais`, `/boas-vindas`.
- Toda rota além de `/<slug>`, `/entrar` e `/cadastro` exige cliente; a Loja também (o catálogo fica atrás da conta, como era no app).
- "Volta ao ponto": `?volta=<caminho>` só aceita caminho dentro da própria loja (`safeReturnPath`); o Google leva o mesmo `volta` dentro do estado assinado (`store_signup.back`).
- Pessoa entrada mas não cliente que toca "Agendar" na página da loja: o botão é um formulário que usa a conta na loja (escolha explícita) e segue para `volta`. GET direto em rota de cliente leva à página da loja com o cartão "Usar minha conta".
- Depois de entrar/cadastrar/usar a conta numa loja pet: sem pet ativo → quiz (`/boas-vindas?volta=...`); com pet → `volta` ou Início.
- O quiz serve também para "Adicionar pet" (`/<slug>/boas-vindas?novo=1`): sem a tela de boas-vindas, mesmas perguntas.
- Idade do quiz em anos ("Menos de 1 ano", 1 a 14, "15 ou mais", "Não sei"); vira `birthMonth` = mês atual da loja menos os anos (menos de 1 ano = 6 meses). Cuidados: as opções rápidas marcadas + o texto, juntos em `careNotes` (". " entre partes).
- A foto do quiz sobe depois que o pet é salvo (rota de arquivo); falha na foto não perde o pet.
- Agendar pula o passo do pet quando há um único pet agendável e o do profissional quando um só faz os serviços; "Qualquer um" vem primeiro.
- Carrinho em cookie `httpOnly` por loja (`af_carrinho`, caminho `/<slug>`, 30 dias, até 20 linhas), lido e preçado no servidor (`priceCart`).
- Volta do Mercado Pago: `/<slug>/loja/pedidos/<id>` confere o pagamento uma vez (no máximo 1 a cada 30 s por pedido) pela função nova `refreshMyOrderPayment`.
- Excluir conta na loja: quem tem senha confirma com a senha; quem só tem Google digita "excluir" (sem caixa alta).
- Limites que a API antiga aplicava por rota (`booking`, `availability`, `redeem`, `postalCode`, `shippingQuote`, `order`) passam a valer nas ações do cliente, por cliente.
- Recompensa em pontos não aparece no sucesso do agendamento (a visão do agendamento não a traz; fica para depois).

## Design visual (decisões do `frontend-design`)

**Assunto e trabalho principal.** Cliente de pet shop, no celular, entre uma mensagem e outra: quer ver quando é o banho do Thor e marcar o próximo em segundos. O protagonista é o pet, não a loja nem o calendário.

**Paleta (tokens, sem cor nova):**

| Papel | Token | Valor da marca | Na loja |
|---|---|---|---|
| Fundo de página (Espuma) | `--ground` | #F3F8F6 | igual |
| Cartão, folha | `--surface` | #FFFFFF | igual |
| Texto (Tinta) | `--ink` / `--ink-muted` | #0F2A27 / #4A615D | igual |
| Ação, nav ativa, botão principal | `--brand` / `--on-brand` | Água #0B6E66 / #FFF | cor da loja (motor `deriveTheme`) |
| Selecionado, horário livre (Bolha) | `--brand-tint` | #D7EFEB | tom da cor da loja |
| O seu horário, celebração (Caramelo) | `--accent` / `--accent-tint` | #F2A93B / #FCEBD0 | destaque da loja; nunca texto |

Contraste garantido: `storeTheme` (Tarefa 5) confere `--on-brand`/`--brand`, `--brand-text`/`--ground`, `--brand-text`/`--surface` e `--ink`/`--brand-tint` ≥ 4,5; qualquer falha volta ao tema Agenda Flui inteiro (como `storePalette` do app). Bordas por `--line`; sombra (`--shadow-pop`) só no que flutua: barra de navegação, barra "Continuar", folhas e diálogos. Cartões comuns sem sombra.

**Tipo:** Bricolage Grotesque (títulos e números grandes) + Figtree (texto). Escala dos tokens:
- Nome do pet no Início e hora no sucesso: `--text-h1` (32→44), peso 700, `-0.02em`; hora com `font-variant-numeric: tabular-nums`.
- Pergunta do quiz e título de página: `--text-h2` (26→32), peso 700.
- Título de cartão: `--text-h3` 22/600. Texto: `--text-body` 16. Metadados: `--text-small` 14/500.
- Horários (chips): 15 px, peso 600, `tabular-nums` (token "time" da marca).
- Proibido: caixa alta em rótulo, sobretítulo acima de título, "→" em botão, palavra destacada em cor dentro de título.

**Forma e hierarquia:** blocos de destaque (herói do Início, capa, sucesso) `--radius-block` 28; cartões 16; chips e campos 10; botões e selos pílula. Não é tudo cartão: listas (horários, extrato, pedidos) são linhas com divisória `--line`.

**O elemento memorável (só um): a espuma.** As bolhas (`Bubbles`, grafismo da marca) aparecem paradas no herói do Início e sobem uma única vez, em celebração, ao concluir o quiz e ao marcar um horário (`Celebration`). Nada mais na área ganha enfeite.

**Momentos de movimento** (só `transform`/`opacity`, tokens `--af-dur-*`/`--af-ease`; em `reduce` tudo aparece no lugar, sem animar):
1. Página: `PageTransition` existente.
2. Quiz e passos do Agendar (`StepStage`): a pergunta nova entra deslizando 24 px no sentido do avanço e de `scale(.98)` para 1 (250 ms); voltar inverte o sentido.
3. Barra de progresso (`ProgressBar`): `scaleX` acompanha a etapa (250 ms); contador "3 de 8" ao lado.
4. Toque em cartão/chip (`ChoiceCard`, `TimeGrid`): `scale(.98)` ao pressionar (150 ms); o visto do escolhido entra de `scale(.6)`/opacidade 0 (150 ms).
5. Barra "Continuar" do Agendar: sobe de `translateY(100%)` quando há escolha válida (200 ms).
6. Celebração (`Celebration`): selo do visto de `scale(.6)` a 1 (250 ms) e 8 bolhas sobem com `translateY` e opacidade, defasadas, em 1,2 s, uma vez; com `reduce`, só o selo.
7. Esqueletos: o pulso existente do `Skeleton`.

**Desenhos (layout).** Coluna única no celular (margem 16 px); no computador (≥ 960 px), barra do topo com a navegação e conteúdo em até 72 rem, alinhado à esquerda.

```
Celular — Início (cliente)                Celular — Agendar, passo do horário
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ (logo) Focinho Feliz    (MS) │          │ ‹ Voltar        ▬▬▬▬▬▬▭▭ 4/5 │
│                              │          │ Quando?                      │
│ Oi, Marina                   │          │ Thor · Banho · com Ana       │
│ ╭──────────────────────────╮ │          │ ┌──┐┌──┐┌──┐┌──┐┌──┐┌──┐ →  │
│ │ Thor             (cão ·) │ │          │ │Hj││Am││Sb││Dm││Sg││Te│    │
│ │ Amanhã, 14:00    o  O    │ │          │ │25││26││27││28││29││30│    │
│ │ Banho · com Ana     o    │ │          │ └──┘└──┘└──┘└──┘└──┘└──┘    │
│ │ [Remarcar] [Cancelar]    │ │          │ Manhã                        │
│ ╰──────────────────────────╯ │          │ [09:00][09:30][10:00][10:30] │
│ Agendar de novo              │          │ Tarde                        │
│ Banho para Thor com Ana    ▸ │          │ [14:00][14:30][15:00]        │
│ ◀ banner banner banner ▶     │          │                              │
│ Seus pets  (Thor)(Mel)  (+)  │          │ ┌──────────────────────────┐ │
│ 120 pontos              ▸    │          │ │ Continuar  sáb, 14:30    │ │
│ ╭─────────────────────────╮  │          │ └──────────────────────────┘ │
│ │Início Agendar Horários  │  │          └──────────────────────────────┘
│ │      Pets  Mais         │  │
│ ╰─────────────────────────╯  │          Celular — Quiz (uma pergunta)
└──────────────────────────────┘          ┌──────────────────────────────┐
                                          │ ‹          ▬▬▬▭▭▭▭▭  3 de 8 │
Celular — Loja (sem sessão)               │ Qual é o porte?              │
┌──────────────────────────────┐          │ ┌─────────────┐┌───────────┐│
│ ░░░░ capa ou bolhas ░░░░░░░░ │          │ │  (desenho)  ││ (desenho) ││
│ (logo)                       │          │ │ Pequeno     ││ Médio  ✓  ││
│ Focinho Feliz Pet Shop       │          │ │ até 10 kg   ││ 10 a 25 kg││
│ Rua X, 10 · (11) 9999-0000   │          │ └─────────────┘└───────────┘│
│ Serviços                     │          │ ┌─────────────┐┌───────────┐│
│ Banho       a partir de R$50 │          │ │ Grande      ││ Gigante   ││
│ Banho e tosa a partir de R$80│          │ │ 25 a 45 kg  ││ +45 kg    ││
│ ...                          │          │ └─────────────┘└───────────┘│
│ feito com Agenda Flui        │          │ [ Continuar ]                │
│ [   Agendar   ] [ Entrar ]   │          └──────────────────────────────┘
└──────────────────────────────┘

Computador — Início
┌───────────────────────────────────────────────────────────────────────┐
│ (logo) Focinho Feliz   Início  Agendar  Horários  Pets  Mais    (MS)  │
├───────────────────────────────────────────────────────────────────────┤
│ Oi, Marina                                                            │
│ ╭────────────────────────────────────╮  Agendar de novo               │
│ │ herói do próximo horário (bolhas)  │  Banho para Thor com Ana   ▸   │
│ ╰────────────────────────────────────╯  Seus pets (Thor) (Mel) (+)    │
│ ◀ banners ▶                             120 pontos                ▸   │
└───────────────────────────────────────────────────────────────────────┘
```

**Revisão contra o padrão genérico (o que mudou da primeira ideia):** (1) o próximo horário como "ingresso" com picote é clichê → virou o herói do pet, nome grande e desenho do porte; (2) capa com degradê → capa da loja (imagem de entrada) ou painel liso na cor da loja com as bolhas da marca; (3) tudo em cartões iguais com a mesma sombra → três raios por hierarquia, listas como linhas, sombra só no que flutua; (4) passos numerados "01/02" → barra de progresso com contador, porque o fluxo é de fato uma sequência e o número só aparece ali.

**Textos fixos principais** (voz da marca): botões "Agendar", "Continuar", "Confirmar horário", "Remarcar", "Cancelar horário", "Manter horário", "Adicionar outro pet", "Agendar agora", "Resgatar", "Pôr no carrinho", "Ir para o pagamento"; sucesso "Horário marcado" (confirmado) / "Pedido de horário enviado" + "A loja confirma e avisa você por e-mail." (pendente); vazio de horários "Nenhum horário marcado" + "Agendar"; vazio de pets "Nenhum pet ainda" + "Adicionar pet".

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/server/auth/customer-access.ts` | Visita à loja: loja aberta, pessoa, cliente ativo ligado; contexto do cliente; limites; destino depois de entrar |
| `src/shared/return-path.ts` | `safeReturnPath` |
| `src/server/domain/storefront/storefront.ts` | Vitrine pública da loja |
| `src/server/domain/scheduling/customer-home.ts` | Início e "Agendar de novo" |
| `src/server/domain/scheduling/ics.ts` | Arquivo `.ics` |
| `src/server/auth/store-leave.ts` | Excluir conta na loja |
| `src/shared/theme/store-theme.ts` | Tema da loja com contraste garantido |
| `src/ui/components/{ChoiceCard,DayStrip,TimeGrid,Celebration,StepStage,ProgressBar,cliente-illustrations}.tsx` | Peças visuais da área do cliente |
| `src/ui/shells/{ClienteShell,ClienteSkeleton}.tsx`, `src/ui/shells/cliente-nav.ts`, `src/ui/styles/cliente.css` | Moldura do cliente |
| `src/app/app/[slug]/layout.tsx`, `error.tsx`, `not-found.tsx`, `_lib/**` | Tema da loja, frame, ações e consultas do cliente |
| `src/app/app/[slug]/{page,boas-vindas,agendar,horarios,pets,premios,loja,mais}/**` | Telas |

## Grupos de execução

| Grupo | Tarefas | Fecha com |
|---|---|---|
| G1 — Acesso e domínio do cliente | 1, 2, 3, 4 | `npm run typecheck` + testes tocados |
| G2 — Visual e moldura | 5, 6 | idem |
| G3 — Quiz e pets | 7, 8, 9 | idem |
| G4 — Agendar, Início e Horários | 10, 11, 12, 13 | idem |
| G5 — Prêmios e Loja | 14, 15, 16 | idem |
| G6 — Mais, acabamento e verificação | 17, 18 | verificação completa |

Cada grupo começa com o anterior commitado; dentro do grupo, em ordem. G3 e G5 só dependem de G1–G2 e podem rodar em paralelo em árvores separadas, se o coordenador quiser.

---

## G1 — Acesso e domínio do cliente

### Tarefa 1: Visita à loja, guarda do cliente e volta ao ponto

**Files:**
- Create: `src/server/auth/customer-access.ts`, `src/shared/return-path.ts`, `src/app/app/[slug]/_lib/acao.ts`, `src/app/app/[slug]/_lib/consulta.ts`, `tests/integration/customer-access.test.ts`, `tests/unit/return-path.test.ts`, `tests/integration/cliente-acao.test.ts`
- Modify: `src/server/auth/guards.ts`, `src/server/domain/errors.ts` (`'rate_limited'` em `DOMAIN_REASONS`, se faltar), `src/server/auth/customer-context.ts` (absorvido por `customer-access.ts` se ainda existir; apague o arquivo e ajuste importadores), `src/server/auth/google/flow.ts` (`store_signup` ganha `back?: string`), `src/server/auth/google/callback.ts` (sucesso de `store_signup` vai para `customerLandingPath`), `src/app/app/[slug]/entrar/{page,actions}.tsx`, `src/app/app/[slug]/cadastro/{page,actions,CadastroForm}.tsx`, `src/app/app/[slug]/actions.ts` ("Usar minha conta" com `volta`), `src/ui/components/GoogleButton.tsx` (prop `volta?: string`, campo escondido), `src/app/app/google/entrar/route.ts` (lê `volta`)
- Test: `tests/integration/{store-entry-actions,google-callback}.test.ts` (casos novos de `volta`)

**Interfaces:**
- Consumes: `getPersonSession`, `findOpenStore`, `storeRelation`, `joinStore` (fase 1); `listMyPets`, `getNicheSettings` (fase 2); `createTenantContext`, `hitRateLimit`, `limitKey`, `LIMITS`.
- Produces (`customer-access.ts`):
```ts
export type OpenStore = StoreRef & { timeZone: string }
export function loadOpenStore(slug: string): Promise<OpenStore | null>
export type StorePerson = { userId: string; name: string; email: string; phone: string | null }
export type StoreVisit =
  | { kind: 'unavailable' }
  | { kind: 'anonymous'; store: OpenStore; ctx: TenantContext }                       // ator guest
  | { kind: 'visitor'; store: OpenStore; ctx: TenantContext; person: StorePerson; isStaff: boolean; blocked: boolean }
  | { kind: 'customer'; store: OpenStore; ctx: TenantContext; person: StorePerson; customerId: string; isStaff: boolean }
export type CustomerVisit = Extract<StoreVisit, { kind: 'customer' }>
export function resolveStoreVisit(i: { token: string | undefined; slug: string; request: RequestInfo; now?: Date }): Promise<StoreVisit>
export type CustomerRate = 'booking' | 'availability' | 'redeem' | 'postalCode' | 'shippingQuote' | 'order'
export function assertCustomerRate(v: CustomerVisit, rule: CustomerRate, now: Date): Promise<void>
// estourou: DomainError('conflict', 'Muitas tentativas seguidas. Espere um minuto e tente de novo.', { reason: 'rate_limited' })
export function customerLandingPath(v: CustomerVisit, back: string | null): Promise<string>
// loja pet sem pet ativo → `/<slug>/boas-vindas` (+ `?volta=<back>` quando houver); senão back ?? `/<slug>`
```
  Regras de `resolveStoreVisit`: slug inválido/reservado/inexistente/loja não `ACTIVE` → `unavailable`; sem sessão ou sessão de suporte → `anonymous`; pessoa: lê o cliente com `business_id = loja`, `user_id = pessoa`; ausente → `visitor` (`blocked=false`); arquivado ou anonimizado → `visitor` `blocked=true`; ativo → `customer` com `ctx` de ator `{ kind: 'customer', customerId, name }`, `channel: 'app'`, `timeZone` da loja, relido a cada chamada (nunca em cache entre requisições). `isStaff` = vínculo ativo da pessoa nesta loja.
- Produces (`guards.ts`): `readStoreVisit(slug: string): Promise<StoreVisit>` (`cache()` por requisição; cookie `APP_COOKIE` + `request-info`); `requireCustomer(slug: string, here: string): Promise<CustomerVisit>` — `unavailable` → `redirect('/<slug>')`; `anonymous` → `redirect('/<slug>/entrar?volta=<here>')`; `visitor` → `redirect('/<slug>?volta=<here>')`.
- Produces (`return-path.ts`): `safeReturnPath(slug: string, raw: string | null | undefined): string | null` — aceita só `/<slug>` ou `/<slug>/…`, até 300 caracteres, caminho `[a-z0-9-/]`, consulta opcional `[A-Za-z0-9=&%,._-]`; recusa `//`, `\`, `..`, esquema, outra loja.
- Produces (`_lib/acao.ts`): `clienteAction<V, R>(parse: (fd: FormData) => V, run: (v: CustomerVisit, values: V) => Promise<R>, done: (r: R, values: V, v: CustomerVisit) => FormState<V>): (slug: string, prev: FormState<V>, fd: FormData) => Promise<FormState<V>>` — chama `requireCustomer(slug, '/<slug>')` em TODA execução antes de ler o formulário; erros por `formError(..., MENSAGEM_GENERICA)`; `redirect`/`notFound` passam.
- Produces (`_lib/consulta.ts`, módulo comum sem `'use server'`, importado pelos arquivos de consultas): `type Pedido<T> = ({ ok: true } & T) | { ok: false; message: string; reentrar: string | null }`; `consultar<T>(slug: string, fn: (v: CustomerVisit) => Promise<T>): Promise<Pedido<T>>` — visita que não é cliente → `{ ok: false, message: 'Entre de novo para continuar.', reentrar: '/<slug>/entrar' }`; `DomainError` → mensagem; outro erro → `MENSAGEM_GENERICA` e log só com o nome.
- `GoogleIntent` `store_signup` vira `{ kind: 'store_signup'; slug: string; back?: string }` (o esquema passa `back` por `safeReturnPath`; inválido = ausente).

- [ ] **Step 1: Testes que falham.** `tests/integration/customer-access.test.ts` (lojas A e B pet, pessoa P cliente de A, cliente Q de A, fábricas da fase 1):
  - `test('sem sessão: anonymous com contexto guest da loja')`
  - `test('pessoa cliente de A vista em B: visitor, sem customerId e sem nada de A')` (Review Focus 1)
  - `test('sessão lembrando A (customerBusinessId) não dá acesso de cliente em B')` (Review Focus 1)
  - `test('cliente ativo: customer com ator customer, customerId do próprio vínculo e fuso da loja')`
  - `test('cliente arquivado ou anonimizado: visitor blocked')` / `test('arquivar entre duas chamadas: a segunda já é visitor blocked')` (Review Focus 5)
  - `test('loja suspensa, inexistente ou slug reservado: unavailable')`
  - `test('sessão de suporte: anonymous')`
  - `test('equipe da loja que também é cliente: customer com isStaff')`
  - `test('assertCustomerRate booking: 21ª em 60 s recusa com rate_limited; outro cliente não é afetado')`
  - `test('customerLandingPath: loja pet sem pet → /a/boas-vindas?volta=/a/agendar; com pet → /a/agendar; sem volta → /a')`
  `tests/unit/return-path.test.ts`: aceita `/a`, `/a/agendar?pet=<uuid>&servicos=<uuid>,<uuid>`; recusa `/b/agendar`, `//a`, `/a/../b`, `https://x/a`, `/a\\x`, `/A`, 301 caracteres, `null`.
  `tests/integration/cliente-acao.test.ts` (mocks de `next/headers`, `next/navigation` e `request-info` como em `painel-customers-actions.test.ts`): ação montada com `clienteAction` — sem sessão → `redirect('/a/entrar?volta=%2Fa')`; visitante → `redirect('/a?volta=%2Fa')`; slug de outra loja com a sessão de cliente de A → `redirect('/b?volta=%2Fb')` e `run` não é chamado; cliente → `run` recebe o `customerId` da sessão mesmo com `customerId` forjado no formulário.
  Em `store-entry-actions.test.ts`: `test('entrar com volta=/a/agendar e pet cadastrado vai para /a/agendar')`, `test('cadastro novo vai para /a/boas-vindas?volta=%2Fa%2Fagendar')`, `test('volta de outra loja é ignorada')`. Em `google-callback.test.ts`: `test('store_signup com back: cliente novo cai no quiz com volta; back inválido é descartado no início do fluxo')`.
- [ ] **Step 2:** `npx vitest run tests/integration/customer-access.test.ts tests/unit/return-path.test.ts tests/integration/cliente-acao.test.ts tests/integration/store-entry-actions.test.ts tests/integration/google-callback.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Prisma cru só em `customer-access.ts` (pasta `auth`). Contexto guest com `createGuestContext` (ou o equivalente que a fase 1 deixou). As telas de entrada leem `?volta=` por `safeReturnPath`, guardam em campo escondido e as ações terminam em `redirect(await customerLandingPath(visita, volta))`.
- [ ] **Step 4:** os testes do Step 2 + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: visita à loja, guarda do cliente e volta ao ponto`.

### Tarefa 2: Vitrine da loja e Início no domínio

**Files:**
- Create: `src/server/domain/storefront/storefront.ts`, `src/server/domain/scheduling/customer-home.ts`, `tests/integration/storefront.test.ts`, `tests/integration/customer-home.test.ts`

**Interfaces:**
- Consumes: `listServices` (visão de cliente), `fromPrice`, `getNicheSettings`, `getModules`, `getSchedulingRules`, `listMyPets`, `listServicesForPet`, `getNextAppointment`, `listLiveBanners`, `getCustomerLoyalty`, `listProfessionals`, `formatDuration`.
- Produces:
```ts
export type StorefrontService = { id: string; name: string; description: string | null; icon: ServiceIconName; from: { cents: number; varies: boolean } | null; durationLabel: string; clubOnly: boolean }
export type Storefront = {
  name: string; address: string | null
  phone: { label: string; href: string; whatsappHref: string | null } | null
  services: StorefrontService[]; modules: Modules; petNiche: boolean; servesCats: boolean
  rules: { changeWindowMin: number; changeWindowLabel: string }
}
export async function getStorefront(ctx: TenantContext): Promise<Storefront>   // ator guest ou customer; outro → forbidden

export type RebookSuggestion = { petId: string; petName: string; serviceIds: string[]; serviceNames: string[]; professionalId: string | null; professionalName: string | null; query: string }
export type CustomerHome = { firstName: string; pets: PetView[]; next: AppointmentView | null; rebook: RebookSuggestion | null; banners: { id: string; title: string; imageUrl: string; linkUrl: string | null }[]; points: number | null }
export async function getRebookSuggestion(ctx: TenantContext): Promise<RebookSuggestion | null>
export async function getCustomerHome(ctx: TenantContext): Promise<CustomerHome>   // só ator customer
```
  Valores: `durationLabel` = `formatDuration` da duração única, ou "1 h a 1 h 30" com menor e maior das variantes visíveis (iguais → uma só). `changeWindowLabel` = "até 2 h antes" / "até 1 dia antes" / "a qualquer momento" (0). `whatsappHref` = `https://wa.me/55<dígitos>` só para celular (11 dígitos). Serviço sem preço visível (`fromPrice` nulo) sai da vitrine. `rebook`: último agendamento `COMPLETED` do cliente (senão o último passado `CONFIRMED`) com pet ativo; mantém só serviços ativos e oferecidos ao pet hoje (`listServicesForPet`); profissional mantido se ativo e faz todos, senão `null`; nenhum serviço sobrando → `null`; pet gato com gatos desligados → `null`. `query` = `?pet=<id>&servicos=<a>,<b>[&profissional=<id>]`. `banners` só com módulo `banners`; `points` só com `loyalty` (senão `null`). `firstName` = primeira palavra do nome do cliente.

- [ ] **Step 1: Testes que falham.** `storefront.test.ts`: `test('vitrine traz "a partir de" do menor preço visível e varies')`, `test('gatos desligados: linha de gato não entra no preço nem na duração')`, `test('serviço inativo, arquivado ou sem preço visível não aparece')`, `test('não traz documento, e-mail de contato nem dado interno')` (chaves do objeto conferidas), `test('whatsapp só para celular')`, `test('rótulo do prazo: 120 → "até 2 h antes", 1440 → "até 1 dia antes", 0 → "a qualquer momento"')`, `test('ator membro → forbidden')`. `customer-home.test.ts`: `test('próximo horário é o do próprio cliente, nunca o de outro cliente da loja')` (Review Focus 2), `test('rebook usa o último concluído e o profissional que ainda faz tudo')`, `test('rebook tira serviço arquivado e serviço que não atende o porte atual do pet')`, `test('rebook nulo quando o pet foi arquivado ou é gato com gatos desligados')`, `test('módulos desligados: banners vazios e points null')`, `test('ator guest → forbidden')`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** Implementar. **Step 4:** rodar + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: vitrine da loja e Início do cliente no domínio`.

### Tarefa 3: Remarcar sem bater em si mesmo e arquivo de agenda

**Files:**
- Create: `src/server/domain/scheduling/ics.ts`, `tests/unit/ics.test.ts`, `tests/integration/customer-reschedule-availability.test.ts`
- Modify: `src/server/domain/scheduling/availability.ts` (`getAvailability`, `listAvailableDays`, `computeFreeStarts`, `loadDayOccupancy`/`loadRangeRows`)

**Interfaces:**
- `getAvailability(ctx, q: { date; serviceIds?: string[]; professionalId?; petId?; rescheduling?: string | null })` e `listAvailableDays(ctx, q: { from; to; serviceIds?: string[]; professionalId?; petId?; rescheduling?: string | null })`: com `rescheduling` (id de agendamento), o cliente só pode passar um agendamento próprio aberto e dentro do prazo (senão `not_found` / a mesma recusa de prazo de `assertCustomerWindow`); serviços, pet e duração vêm dele quando não enviados; a ocupação ignora esse agendamento (os demais, inclusive encaixes, continuam ocupando). Equipe pode passar `rescheduling` de qualquer agendamento do seu escopo.
- `ics.ts`:
```ts
export type IcsEvent = { uid: string; startsAt: Date; endsAt: Date; stamp: Date; summary: string; description: string; location: string | null; url: string }
export function buildIcs(e: IcsEvent): string
export async function appointmentIcs(ctx: TenantContext, id: string, i: { storeName: string; address: string | null; url: string }): Promise<{ filename: string; body: string }>
```
  `buildIcs`: `BEGIN:VCALENDAR`/`VERSION:2.0`/`PRODID:-//Agenda Flui//PT-BR`/`METHOD:PUBLISH`, um `VEVENT` com `UID:<id>@agendaflui`, `DTSTAMP`, `DTSTART`, `DTEND` em UTC (`YYYYMMDDTHHMMSSZ`), `SUMMARY`, `DESCRIPTION`, `LOCATION` (quando houver), `URL`; escapa `\`, `;`, `,` e quebra de linha; linhas dobradas em 75 octetos; CRLF. `appointmentIcs`: só pelo `getAppointment` (cliente: só o próprio); `summary` = "Banho e Hidratação para Thor em Focinho Feliz"; `description` = profissional + "Para mudar, abra <url>."; `filename` = `horario-<AAAA-MM-DD>.ics`.

- [ ] **Step 1: Testes que falham.** `customer-reschedule-availability.test.ts` (conta pet, Thor com Banho 14:00–15:00, Ana, grade 30 min): `test('remarcar 30 min para frente: 14:30 aparece e rescheduleAppointment grava')` (Review Focus 3), `test('o horário de outro cliente continua ocupado na lista de remarcar')`, `test('rescheduling de agendamento de outro cliente → not_found')` (Review Focus 2), `test('rescheduling fora do prazo → recusa de prazo')`, `test('listAvailableDays com rescheduling marca o dia do próprio horário como disponível')`, `test('sem rescheduling o próprio horário ocupa (comportamento antigo)')`. `ics.test.ts`: datas UTC corretas para um horário de São Paulo; escapa `Banho, tosa; "x"\n`; linha de 200 caracteres dobrada com CRLF + espaço; termina em CRLF; sem `LOCATION` quando nulo.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes do Step 1 + `tests/integration/availability.test.ts tests/integration/appointments-pet.test.ts` + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: horários livres para remarcar e arquivo .ics do agendamento`.

### Tarefa 4: Excluir conta na loja, pagamento na volta e foto do pet pelo cliente

**Files:**
- Create: `src/server/auth/store-leave.ts`, `tests/integration/store-leave.test.ts`, `tests/integration/order-return.test.ts`
- Modify: `src/server/domain/store/checkout.ts` (`refreshMyOrderPayment`), `src/server/domain/pets/photo.ts` (só se `setPetPhoto` ainda recusar o ator cliente)
- Test: `tests/integration/pets.test.ts` (caso novo)

**Interfaces:**
- `store-leave.ts`:
```ts
export const DELETE_CONFIRM_WORD = 'excluir'
export async function deleteStoreAccount(
  i: { userId: string; businessId: string; customerId: string; password?: string | null; confirm?: string | null; sessionToken: string },
  meta: RequestMeta, now: Date,
): Promise<{ personDeleted: boolean; nextPath: string }>
```
  Pessoa com senha: senha certa obrigatória (mesmo limite de `setPersonPassword`, chave `senha-pessoa:<id>`; errada → `validation` `fields.password` "Senha incorreta."). Só Google: `confirm` igual a `DELETE_CONFIRM_WORD` (aparado, minúsculas; senão `fields.confirm` "Digite excluir para confirmar."). Depois: `anonymizeCustomer` com o contexto de cliente (pedidos em andamento → a recusa dele sobe como está). Em seguida, transação do Prisma cru com `lockUserAccess`: se a pessoa não tem nenhum `Customer` com `user_id` (qualquer estado) nem `Membership` (qualquer estado) → apaga códigos `EMAIL_CHANGE` dela e a pessoa (sessões e tokens caem em cascata), `personDeleted: true`, `nextPath: '/entrar?conta=excluida'`; senão limpa `customer_business_id` das sessões dela que apontam para a loja e `nextPath = destinationPath(await destinationFor(sessão))`. Auditoria `customer.account_deleted_by_customer` (ids apenas).
- `refreshMyOrderPayment(ctx: TenantContext, orderId: string): Promise<OrderView>` em `checkout.ts` — só ator cliente, pedido próprio (`not_found` senão); só consulta o Mercado Pago (`syncOrderPayments`) quando `AWAITING_PAYMENT` e o limite `mp-retorno:<orderId>` (1 a cada 30 s, regra nova `orderReturn: { limit: 1, windowSec: 30 }` em `LIMITS`) deixa; devolve `getOrder`.
- `setPetPhoto(ctx, petId, image)` aceita ator cliente para pet próprio (pet alheio → `not_found`).

- [ ] **Step 1: Testes que falham.** `store-leave.test.ts`: `test('cliente de uma loja só, com senha: anonimiza, apaga a pessoa e derruba as sessões')`, `test('cliente de duas lojas: anonimiza só nesta; a pessoa fica e entra na outra loja')`, `test('pessoa que é da equipe (mesmo inativa) não é apagada')`, `test('senha errada: nada muda')`, `test('só Google: exige "excluir"; "EXCLUIR " também vale')`, `test('pedido pago não entregue: recusa "Conclua ou cancele os pedidos em andamento antes." e nada muda')`, `test('horários futuros do cliente são cancelados')`. `order-return.test.ts` (Mercado Pago falso): `test('volta do pagamento aprovado: pedido fica pago')`, `test('segunda volta em menos de 30 s não consulta de novo')`, `test('pedido de outro cliente → not_found')` (Review Focus 2), `test('pedido já pago: devolve sem consultar')`. `pets.test.ts`: `test('cliente põe foto no próprio pet; no de outro cliente → not_found')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes do Step 1 + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: excluir conta na loja, conferir pagamento na volta e foto do pet pelo cliente`.

**G1 termina:** `npm run typecheck && npx vitest run <testes tocados em 1–4>`.

---

## G2 — Visual e moldura

### Tarefa 5: Tema da loja com contraste garantido e peças visuais

**Files:**
- Create: `src/shared/theme/store-theme.ts`, `src/ui/components/{ChoiceCard,DayStrip,TimeGrid,Celebration,StepStage,ProgressBar,cliente-illustrations}.tsx`, `src/ui/styles/cliente.css`, `tests/unit/store-theme.test.ts`, `tests/unit/ui/cliente-pecas.test.tsx`
- Modify: `src/ui/components/index.ts`, `src/ui/ui.css` (`cliente.css` antes de `motion.css`)

**Interfaces:**
- `storeTheme(theme: ThemeTokens): { theme: ThemeTokens; fellBack: boolean }` — confere os quatro pares do Design (≥ 4,5 por `contrastRatio`); falhou um → tema padrão da marca (`deriveTheme` das cores Agenda Flui), `fellBack: true`.
- `ChoiceCard({ type: 'radio' | 'checkbox'; name; value; checked; onChange; title: string; detail?: string; media?: ReactNode; disabled?: boolean; disabledReason?: string })` — `<label>` com `<input>` nativo visualmente escondido (teclado e leitor de tela de graça), visto que entra animado, `scale(.98)` ao pressionar; desabilitado mostra `disabledReason`.
- `DayStrip({ days: { date: string; label: string; weekdayShort: string; available: boolean }[]; value: string | null; onChange; onMore?: () => void; moreLoading?: boolean })` — rolagem horizontal com `scroll-snap`, `role="radiogroup"` `aria-label="Dia"`, setas movem; dia sem horário esmaecido com "Sem horário" no `aria-label`; botão final "Mais dias".
- `TimeGrid({ groups: { label: 'Manhã' | 'Tarde' | 'Noite'; times: { iso: string; label: string }[] }[]; value: string | null; onChange })` — chips de 44 px de altura, `tabular-nums`; grupos por hora local (< 12, < 18, resto).
- `Celebration({ play: boolean })` — selo do visto + 8 bolhas `aria-hidden`; com `prefers-reduced-motion: reduce` só o selo (por CSS).
- `StepStage({ stepKey: string; direction: 1 | -1; children })` — troca animada; move o foco para o primeiro título (`h1`/`h2` com `tabIndex={-1}`) da etapa nova.
- `ProgressBar({ value: number; max: number; label: string })` — `role="progressbar"` com `aria-valuenow/max` e texto "3 de 8".
- `cliente-illustrations.tsx`: `SpeciesIllustration({ species: 'DOG' | 'CAT'; size?: number })` e `EmptyIllustration({ name: 'horarios' | 'pets' | 'premios' | 'carrinho' | 'pedidos' | 'loja-fechada'; size?: number })` — SVG em traço (`stroke="currentColor"`, 1.75, pontas redondas, `viewBox 0 0 64 64`), `aria-hidden`; os portes usam `PetIllustration` da fase 2.
- `cliente.css`: classes `af-cl-*` (prefixo da área), raios e sombras do Design; todo movimento dentro de `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 1: Testes que falham.** `store-theme.test.ts`: `test('cor da loja legível passa intacta')`, `test('amarelo #FFFF00 ou branco #FFFFFF: volta ao tema Agenda Flui com fellBack')`, `test('o tema devolvido sempre cumpre os quatro pares')` (varre 12 cores fixas). `cliente-pecas.test.tsx`: `test('ChoiceCard é radio nativo, marca e mostra o motivo quando desabilitado')`, `test('DayStrip: dia sem horário não é escolhível e as setas movem a escolha')`, `test('TimeGrid agrupa 09:00 em Manhã e 14:30 em Tarde e devolve o iso')`, `test('ProgressBar anuncia "3 de 8"')`, `test('StepStage põe o foco no título da etapa nova')`, `test('Celebration e as ilustrações são aria-hidden')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar (sem dependência nova; nada de `width` fixa maior que 360 px). **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: tema da loja com contraste garantido e peças da área do cliente`.

### Tarefa 6: Moldura do cliente, página da loja e loja indisponível

**Files:**
- Create: `src/ui/shells/ClienteShell.tsx`, `src/ui/shells/ClienteSkeleton.tsx`, `src/ui/shells/cliente-nav.ts`, `src/app/app/[slug]/layout.tsx`, `src/app/app/[slug]/error.tsx`, `src/app/app/[slug]/not-found.tsx`, `src/app/app/[slug]/_lib/{ClienteFrame,LojaPublica,ModuloDesligado}.tsx`, `src/app/app/[slug]/mais/{page,loading}.tsx`, `tests/unit/cliente-nav.test.ts`, `tests/unit/ui/loja-publica.test.tsx`
- Modify: `src/ui/shells/index.ts`, `src/app/app/[slug]/page.tsx` (sai a home provisória da fase 1), `src/app/app/[slug]/loading.tsx`, `src/app/app/[slug]/_lib/{UsarMinhaConta,LojaIndisponivel}.tsx` (visual novo)

**Interfaces:**
- `clienteNav(slug: string, i: { pets: boolean }, pathname: string): NavItem[]` — Início `/<slug>` (`exact`), Agendar, Horários, Pets (só loja pet), Mais; ícones `House`, `CalendarPlus`, `CalendarClock`, `PawPrint`, `Ellipsis`; `shortLabel` ≤ 8 caracteres. `maisItems(slug: string, modules: Modules): { href: string; label: string; icon: LucideIcon }[]` — Prêmios (só `loyalty`), Loja (só `store`), Minha conta (`/conta`).
- `ClienteShell({ store: { name: string; logoUrl: string | null; symbolUrl: string | null; slug: string }; nav: NavItem[]; person: { name: string } | null; title: string; hideTitle?: boolean; back?: { href: string; label: string }; children })` — celular: barra do topo (logo/símbolo + nome; avatar com iniciais → `/<slug>/mais`) e navegação inferior flutuante; computador: navegação na barra do topo; `PageTransition`; rodapé "feito com Agenda Flui" (link para o site, `--text-small`, `--ink-muted`).
- `ClienteSkeleton({ variant: 'inicio' | 'lista' | 'detalhe' | 'fluxo' | 'grade' })` — mesma moldura, `role="status"` com "Carregando…".
- `ClienteFrame({ visit: CustomerVisit; title: string; hideTitle?: boolean; back?; children })` (servidor) — monta nav com `getStorefront().modules`/`petNiche` e marca por `getPublicBrandBySlug`.
- `layout.tsx`: marca pelo slug; loja aberta → `ThemeScope` com `storeTheme(brand.theme).theme` + `ToastProvider`; fechada → tema da marca. `generateMetadata`: título `<Loja>` e ícone `faviconUrl`.
- Página `/<slug>` (`page.tsx`, `searchParams: Promise<{ volta?: string }>`): `unavailable` → `LojaIndisponivel` (`EmptyIllustration loja-fechada`, título "Loja indisponível", "Esta loja não está disponível agora. Confira o link com a loja."); `customer` → Início (Tarefa 12; até lá, `ClienteFrame` com "Início" e o próximo horário em texto); senão `LojaPublica`.
- `LojaPublica({ brand, storefront, visit })`: capa (`loginImageUrl` em `<img>` com `object-fit: cover`, 16:9 no celular, até 22 rem no computador; sem imagem → painel `--brand` com `Bubbles`), logo em círculo sobreposto, nome em `--text-h1`, endereço e telefone (`tel:` e "WhatsApp" quando houver), lista "Serviços" em linhas (ícone, nome, descrição em 2 linhas, `durationLabel`, "a partir de R$ 50,00" ou "R$ 50,00"; selo "Clube" quando `clubOnly`), "Prazo para mudar um horário: <changeWindowLabel>". Ações (fixas no pé no celular): anônimo → `LinkButton` "Agendar" (`/<slug>/entrar?volta=/<slug>/agendar`) e "Entrar"; visitante → `UsarMinhaConta` em destaque (com "A loja vai ver seu nome, e-mail e telefone." e os três valores) cujo botão "Usar minha conta e agendar" envia `volta`; `blocked` → aviso "Sua conta nesta loja está desativada. Fale com a loja."; `isStaff` → `LinkButton` "Abrir painel".
- `ModuloDesligado({ slug, what: 'Prêmios' | 'Loja' })`: "<what> não está disponível nesta loja agora." + "Ir para o início".
- `error.tsx`: "Não deu para abrir esta página." + botão "Tentar de novo" (`reset`) + link "Ir para o início"; `not-found.tsx`: "Não achamos o que você procurava." + "Ir para o início".
- `/mais` (menu): lista com `maisItems` + seções que a Tarefa 17 completa.

- [ ] **Step 1: Testes que falham.** `cliente-nav.test.ts`: `test('cinco itens na ordem Início, Agendar, Horários, Pets, Mais')`, `test('Pets some sem nicho pet')`, `test('Início só ativo em /a; Horários ativo em /a/horarios/x')`, `test('maisItems sem loyalty e sem store traz só Minha conta')`. `loja-publica.test.tsx`: `test('anônimo vê serviços com "a partir de R$ 50,00" e o botão Agendar com volta')`, `test('visitante vê "Usar minha conta nesta loja" com nome, e-mail e telefone')`, `test('blocked vê o aviso de conta desativada e nenhum botão de agendar')`, `test('equipe vê "Abrir painel"')`, `test('sem capa: painel com bolhas aria-hidden')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: moldura do cliente e página pública da loja`.

**G2 termina:** `npm run typecheck && npx vitest run <testes tocados em 5–6>`.

---

## G3 — Quiz e pets

### Tarefa 7: Máquina do quiz

**Files:**
- Create: `src/app/app/[slug]/boas-vindas/quiz.ts`, `src/app/app/[slug]/boas-vindas/QuizPet.tsx`, `src/app/app/[slug]/boas-vindas/_passos/{Nome,Especie,Porte,Raca,Idade,Pelagem,Cuidados,Foto,Resumo}.tsx`, `tests/unit/cliente-quiz.test.ts`, `tests/unit/cliente-quiz-ui.test.tsx`

**Interfaces:**
```ts
export type QuizAnswers = { name: string; species: PetSpecies; size: PetSize | null; breed: string | null; ageYears: number | null; coat: PetCoat | null; careChips: string[]; careText: string; photo: File | null }
export type QuizState = { steps: QuizStepKey[]; index: number; direction: 1 | -1; answers: QuizAnswers; error: string | null }
export type QuizAction =
  | { type: 'set'; patch: Partial<QuizAnswers> } | { type: 'next' } | { type: 'back' } | { type: 'skip' }
  | { type: 'goto'; step: QuizStepKey } | { type: 'restart' }
export function quizSteps(servesCats: boolean, species: PetSpecies): QuizStepKey[]   // de NICHES.PET.quiz; sem 'species' se !servesCats; sem 'size' se CAT
export function initialQuiz(servesCats: boolean): QuizState                          // species 'DOG'
export function quizReducer(s: QuizState, a: QuizAction): QuizState
export function stepError(step: QuizStepKey, a: QuizAnswers): string | null           // name: "Escreva o nome do pet."; size: "Escolha o porte."
export function toPetInput(a: QuizAnswers, today: string): PetInput
export function birthMonthFromAge(ageYears: number, today: string): string            // 0 → 6 meses antes; n → n anos antes; 'AAAA-MM'
export function breedMatches(query: string, species: PetSpecies, max?: number): string[] // sem acento/caixa; "Sem raça definida" sempre primeiro
```
  Regras do redutor: `next` com `stepError` → fica e grava `error`; `skip` só em passo opcional (limpa a resposta do passo); `back` no primeiro passo não faz nada; trocar `species` recalcula `steps` (gato limpa `size`) mantendo o passo atual; `goto` só para passo já visitado (vindo do Resumo); `direction` = 1 ao avançar, −1 ao voltar.
- `QuizPet({ slug: string; servesCats: boolean; today: string; firstName: string | null; welcome: boolean; back: string | null; salvar: (fd: FormData) => Promise<SalvarPetResultado> })` — topo com "‹" (voltar) e `ProgressBar`; corpo em `StepStage`; uma pergunta por tela com o título de `NICHES.PET.quiz`; Enter avança; botão "Pular" nos opcionais; "Continuar" no pé.
  - Nome: `Input` grande, `autoFocus`, até 40.
  - Espécie: dois `ChoiceCard` com `SpeciesIllustration` ("Cão", "Gato").
  - Porte: quatro `ChoiceCard` em grade 2×2 com `PetIllustration`, `shortLabel` e `rangeLabel`.
  - Raça: campo de busca com lista `breedMatches` (`role="listbox"`, setas e Enter), "Sem raça definida" sempre visível, texto livre aceito.
  - Idade: chips "Menos de 1 ano", 1…14, "15 ou mais", "Não sei" (= pular).
  - Pelagem: três `ChoiceCard` com `coatLabels`.
  - Cuidados: chips de `careQuickOptions` (alternam) + `Textarea` "Conte mais, se quiser".
  - Foto: `<input type="file" accept="image/*">`, prévia redonda, "Trocar foto"/"Tirar foto".
  - Resumo: linhas com o que foi respondido e "Mudar" (→ `goto`), e dois botões: "Agendar agora" e "Adicionar outro pet"; ao salvar, `Celebration` e depois a navegação.
  - `welcome`: antes do primeiro passo, tela "Boas-vindas, <firstName>" / "Conte sobre o seu pet. Leva um minuto." / "Começar".

- [ ] **Step 1: Testes que falham.** `cliente-quiz.test.ts`: `test('sem gatos: passos name, size, breed, age, coat, care, photo, summary')`, `test('com gatos e gato escolhido: sem size e size limpo')`, `test('next sem nome fica no passo com "Escreva o nome do pet."')`, `test('voltar e avançar mantém todas as respostas')`, `test('skip só em opcional e limpa a resposta')`, `test('goto do resumo só para passo visitado')`, `test('toPetInput: 3 anos em 2026-11-25 → birthMonth 2023-11; menos de 1 ano → 2026-05; cuidados "Medo de secador. Alergia. Não gosta de barulho"')`, `test('breedMatches("shi") traz Shih-tzu e "Sem raça definida" primeiro')`. `cliente-quiz-ui.test.tsx`: `test('uma pergunta por tela e a barra diz "1 de 8"')`, `test('voltar mostra o nome digitado antes')`, `test('porte: escolher Médio marca aria-checked e habilita Continuar')`, `test('loja com gatos mostra a pergunta Cão ou gato?; sem gatos não mostra')`, `test('resumo chama salvar com os campos e a foto, e "Mudar" leva ao passo')`, `test('erro de salvar aparece em role=alert e as respostas ficam')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: quiz do pet, uma pergunta por tela`.

### Tarefa 8: Página do quiz, gravação e foto

**Files:**
- Create: `src/app/app/[slug]/boas-vindas/{page,loading,actions}.tsx`, `src/app/app/[slug]/pets/[petId]/foto/route.ts`, `tests/integration/cliente-quiz-actions.test.ts`, `tests/integration/cliente-pet-foto-route.test.ts`

**Interfaces:**
- `type SalvarPetResultado = { ok: true; petId: string; next: string } | { ok: false; message: string; fields: Record<string, string> }`.
- `salvarPetDoQuiz(slug: string, fd: FormData): Promise<SalvarPetResultado>` (`'use server'`, `requireCustomer`): lê `name`, `species`, `size`, `breed`, `birthMonth`, `coat`, `careNotes`, `then` (`'agendar' | 'outro'`), `volta`; chama `createPet(visit.ctx, visit.customerId, input)`; `next` = `then === 'agendar'` → `volta` (se for `/agendar…`) ou `/<slug>/agendar?pet=<id>`; `outro` → `/<slug>/boas-vindas?novo=1`. Loja sem gatos e `species=CAT` → `fields.species` "A loja não atende gatos no momento.".
- Rota `POST /<slug>/pets/[petId]/foto` (multipart `foto`): `resolveStoreVisit` (não cliente → 303 `/<slug>/entrar`), confere origem como as rotas de imagem do painel (`upload-multipart.ts`), `setPetPhoto(ctx, petId, { bytes })`; resposta 303 para `?foto=ok|too_large|invalid|not_found` no caminho de origem (`destino` do formulário, por `safeReturnPath`); com `Accept: application/json` devolve `{ ok, code }` (o quiz usa `fetch`).
- `page.tsx`: `requireCustomer`; loja sem nicho pet → `redirect('/<slug>')`; `welcome` = sem `?novo` e cliente sem pet; `today` = data local da loja; `MAX_ACTIVE_PETS` atingido → tela "Você já tem 20 pets ativos. Arquive algum em Meus pets." com link.
- Fluxo do cliente: `salvar` → se há foto, `fetch` da rota com `Accept: application/json`; foto falhou → toast "Pet salvo. Não deu para enviar a foto; tente de novo em Meus pets." → navega para `next`.

- [ ] **Step 1: Testes que falham.** `cliente-quiz-actions.test.ts`: `test('cria o pet do próprio cliente e devolve /a/agendar?pet=<id>')`, `test('com volta=/a/agendar?servicos=x devolve a volta')`, `test('"outro" devolve /a/boas-vindas?novo=1')`, `test('cão sem porte: fields.size')`, `test('gato com gatos desligados: fields.species')`, `test('customerId forjado no formulário é ignorado')`, `test('visitante: redirect para a loja')`. `cliente-pet-foto-route.test.ts`: `test('foto válida grava e responde ok')`, `test('pet de outro cliente → not_found e nada gravado')` (Review Focus 2), `test('origem de fora → 403')`, `test('arquivo grande → too_large')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: página do quiz com gravação do pet e foto`.

### Tarefa 9: Meus pets

**Files:**
- Create: `src/app/app/[slug]/pets/{page,loading,actions}.tsx`, `src/app/app/[slug]/pets/[petId]/{page,loading,PetEditForm}.tsx`, `tests/integration/cliente-pets-actions.test.ts`, `tests/unit/ui/cliente-pets.test.tsx`

**Interfaces:**
- `/pets`: `ClienteFrame` "Meus pets"; grade de `PetCard` (1 coluna até 560 px, 2 acima, 3 no computador) com `href` para `/pets/<id>`; gato com gatos desligados: selo e texto "A loja não atende gatos no momento" no cartão; botão "Adicionar pet" (→ `/boas-vindas?novo=1`); "Ver arquivados (n)" (`?arquivados=1`) com "Restaurar" em cada; vazio: `EmptyIllustration pets` + "Nenhum pet ainda" + "Adicionar pet".
- `/pets/[petId]`: cabeçalho com foto ou ilustração, nome em `--text-h2`, `typeLabel · rangeLabel`, idade; formulário `PetEditForm` (mesmos campos do quiz numa tela só: Nome, `PetTypePicker` com `staffMayPickCat={false}`, Raça com sugestões, Nascimento aproximado `type="month"`, Pelagem, Cuidados com chips); foto (formulário para a rota da Tarefa 8, `?foto=` vira aviso); "Agendar para <nome>" (→ `/agendar?pet=<id>`, escondido para gato com gatos desligados); "Arquivar pet" com `ConfirmDialog` ("Arquivar Thor? Ele some do Agendar; o histórico fica.").
- Ações (`clienteAction`): `editarPet`, `arquivarPet`, `restaurarPet` → domínio da fase 2 com o contexto do cliente; sucesso: "Pet salvo." / volta à lista com toast "Thor arquivado.".

- [ ] **Step 1: Testes que falham.** `cliente-pets-actions.test.ts`: `test('editar muda o porte do próprio pet')`, `test('editar pet de outro cliente → "Pet não encontrado." e nada muda')` (Review Focus 2), `test('arquivar e restaurar')`, `test('restaurar o 21º pet ativo → mensagem de limite')`. `cliente-pets.test.tsx` (renderiza a lista com dados prontos): `test('gato com gatos desligados mostra "A loja não atende gatos no momento" e sem botão Agendar')`, `test('vazio mostra "Nenhum pet ainda" e "Adicionar pet"')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar (componente da lista separado da página para o teste). **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: Meus pets na área do cliente`.

**G3 termina:** `npm run typecheck && npx vitest run <testes tocados em 7–9>`.

---

## G4 — Agendar, Início e Horários

### Tarefa 10: Máquina do Agendar e telas do fluxo

**Files:**
- Create: `src/app/app/[slug]/agendar/fluxo.ts`, `src/app/app/[slug]/agendar/AgendarFluxo.tsx`, `src/app/app/[slug]/agendar/_passos/{PassoPet,PassoServicos,PassoProfissional,PassoHorario,PassoConfirmar}.tsx`, `src/app/app/[slug]/agendar/consultas.ts`, `tests/unit/cliente-agendar-fluxo.test.ts`, `tests/unit/cliente-agendar-ui.test.tsx`, `tests/integration/cliente-agendar-consultas.test.ts`

**Interfaces:**
```ts
export type FluxoPasso = 'pet' | 'servicos' | 'profissional' | 'horario' | 'confirmar'
export type Sugestao = { iso: string; label: string; date: string }
export type FluxoEstado = {
  modo: 'novo' | 'remarcar'; passos: FluxoPasso[]; passo: FluxoPasso; direction: 1 | -1
  petId: string | null; serviceIds: string[]; professionalId: string | null; professionalChosen: boolean
  date: string | null; startsAt: string | null; note: string; key: string
  aviso: string | null; sugestoes: Sugestao[]
}
export type FluxoAcao =
  | { type: 'pet'; petId: string } | { type: 'servico'; serviceId: string } | { type: 'profissional'; id: string | null }
  | { type: 'dia'; date: string } | { type: 'horario'; iso: string } | { type: 'nota'; text: string }
  | { type: 'avancar' } | { type: 'voltar' } | { type: 'ir'; passo: FluxoPasso }
  | { type: 'ocupado'; message: string; sugestoes: Sugestao[] }
export function iniciarFluxo(i: { key: string; modo: 'novo' | 'remarcar'; pets: { id: string; bookable: boolean }[]; petId?: string | null; serviceIds?: string[]; professionalId?: string | null; singleProfessional?: boolean }): FluxoEstado
export function fluxoReducer(s: FluxoEstado, a: FluxoAcao): FluxoEstado
export function podeAvancar(s: FluxoEstado): boolean
```
  Regras: um único pet agendável → sem passo `pet`; `remarcar` → passos `profissional`, `horario`, `confirmar`; trocar pet limpa serviços, profissional, dia e horário; mudar serviço limpa profissional e horário; trocar profissional ou dia limpa só o horário; `ocupado` volta a `horario` com `aviso` e `sugestoes`, mantendo o resto; escolher uma sugestão (`horario` com iso de outro dia) troca também `date`; pré-seleção (`?pet&servicos&profissional`) começa no primeiro passo incompleto; `key` nasce uma vez por fluxo (`crypto.randomUUID()` sem hífens, ≤ 80) e não muda.
- `consultas.ts` (`'use server'`, cada uma por `consultar(slug, …)` e `assertCustomerRate(…, 'availability')` nas de horário):
```ts
export async function servicosDoPet(slug: string, petId: string): Promise<Pedido<{ servicos: { id: string; name: string; description: string | null; icon: ServiceIconName; priceCents: number; durationMin: number; durationLabel: string; clubOnly: boolean }[] }>>
export async function profissionaisPara(slug: string, serviceIds: string[]): Promise<Pedido<{ profissionais: { id: string; name: string; avatarUrl: string | null }[] }>>
export async function diasLivres(slug: string, q: { from: string; serviceIds: string[]; petId: string; professionalId: string | null; rescheduling: string | null }): Promise<Pedido<{ dias: { date: string; label: string; weekdayShort: string; available: boolean }[]; hasMore: boolean }>>  // 14 dias; até maxAdvanceDays
export async function horariosLivres(slug: string, q: { date: string; serviceIds: string[]; petId: string; professionalId: string | null; rescheduling: string | null }): Promise<Pedido<{ horarios: { iso: string; label: string }[] }>>
```
- Telas: `PassoPet` (`ChoiceCard` com foto/ilustração e `typeLabel`; gato com gatos desligados desabilitado com o motivo; "Adicionar pet" → quiz com `volta=/<slug>/agendar`); `PassoServicos` (`ChoiceCard` checkbox: nome, "1 h · R$ 85,00" do porte do pet, descrição; total corrente no pé "Total R$ 135,00 · 2 h 30"; vazio: "Nenhum serviço para <typeLabel> agora. Fale com a loja."); `PassoProfissional` ("Qualquer um" com "Mais horários livres" primeiro, depois cada profissional com avatar); `PassoHorario` (`DayStrip` + `TimeGrid`; `aviso` em `role="alert"` com as sugestões como chips; dia sem horário: "Sem horários neste dia. Escolha outro."); `PassoConfirmar` (resumo: pet, serviços com preço, profissional ou "Qualquer um", data longa e hora, total; `Textarea` "Recado para a loja" até 500; botão "Confirmar horário" / "Remarcar para este horário"). Pé fixo "Continuar" com o resumo curto da escolha; carregamento de cada consulta com esqueleto no lugar da lista; erro com "Tentar de novo"; `reentrar` → `router.push`.

- [ ] **Step 1: Testes que falham.** `cliente-agendar-fluxo.test.ts`: `test('um pet agendável: começa em servicos')`, `test('trocar o pet limpa serviços, profissional e horário')`, `test('mudar serviço limpa profissional e horário; trocar dia limpa só o horário')`, `test('ocupado volta ao horário com aviso e sugestões e mantém pet, serviços e profissional')` (Review Focus 4), `test('sugestão de outro dia troca date e startsAt')`, `test('pré-seleção completa começa em horario')`, `test('remarcar: passos profissional, horario, confirmar')`, `test('key não muda entre ações')`, `test('podeAvancar falso sem serviço')`. `cliente-agendar-ui.test.tsx` (consultas simuladas): `test('serviços mostram o preço do porte do pet')`, `test('gato com gatos desligados aparece desabilitado com o motivo')`, `test('escolher horário mostra a barra Continuar com o resumo')`, `test('falha de consulta mostra a mensagem e Tentar de novo')`. `cliente-agendar-consultas.test.ts`: `test('servicosDoPet de pet de outro cliente → ok false "Pet não encontrado."')` (Review Focus 2), `test('horariosLivres com rescheduling de outro cliente → ok false')`, `test('diasLivres corta em maxAdvanceDays e diz hasMore')`, `test('61ª consulta de horários em 60 s → mensagem de muitas tentativas')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: fluxo de agendar do cliente`.

### Tarefa 11: Confirmar, sucesso e arquivo de agenda

**Files:**
- Create: `src/app/app/[slug]/agendar/{page,loading,actions}.tsx`, `src/app/app/[slug]/agendar/feito/[id]/{page,loading,Sucesso}.tsx`, `src/app/app/[slug]/horarios/[id]/agenda.ics/route.ts`, `tests/integration/cliente-agendar-actions.test.ts`, `tests/integration/cliente-ics-route.test.ts`

**Interfaces:**
- `page.tsx` (`searchParams: Promise<{ pet?; servicos?; profissional? }>`): `requireCustomer`; loja pet sem pet → `redirect('/<slug>/boas-vindas?volta=/<slug>/agendar')`; monta `AgendarFluxo` com os pets (`bookable` = não gato com gatos desligados) e a pré-seleção validada (ids que não são do cliente são ignorados).
- `marcarHorario = clienteAction(...)` lê `petId`, `serviceIds` (repetido), `professionalId` (vazio = qualquer um), `startsAt` (ISO), `customerNote`, `key`; `assertCustomerRate(v, 'booking')`; `bookAppointment(v.ctx, { petId, serviceIds, professionalId, startsAt, customerNote, idempotencyKey: key })`; sucesso → `redirect('/<slug>/agendar/feito/<id>')`. `slot_taken`/`slot_unavailable` → estado com `message` "Esse horário acabou de ser ocupado. Escolha outro." e `conflict.nearest` (o `AgendarFluxo` despacha `ocupado`).
- `remarcarHorario = clienteAction(...)` lê `appointmentId`, `startsAt`, `professionalId`; `rescheduleAppointment(v.ctx, id, { startsAt, professionalId })` → `redirect('/<slug>/agendar/feito/<id>?remarcado=1')`.
- `feito/[id]`: `getAppointment(v.ctx, id)` (alheio → `notFound()`); `Sucesso` com `Celebration play`, título "Horário marcado" (`CONFIRMED`) / "Horário remarcado" (`?remarcado=1`) / "Pedido de horário enviado" + "A loja confirma e avisa você por e-mail." (`PENDING`); data longa ("sábado, 29 de novembro") e hora em `--text-h1`; pet, serviços, profissional, total; botões "Adicionar à minha agenda" (`/<slug>/horarios/<id>/agenda.ics`, `download`), "Ver meus horários", "Voltar ao início".
- Rota `GET /<slug>/horarios/[id]/agenda.ics`: visita não cliente → 404; `appointmentIcs(v.ctx, id, { storeName, address, url: areaLink('app', '/<slug>/horarios/<id>') })`; `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="<filename>"`, `Cache-Control: private, no-store`; alheio → 404.

- [ ] **Step 1: Testes que falham.** `cliente-agendar-actions.test.ts` (conta pet, Thor médio, Banho por porte, Ana): `test('marca para o próprio pet com o preço do porte e redireciona para feito')`, `test('pet de outro cliente → mensagem de pet e nada gravado')` (Review Focus 2), `test('mesma key duas vezes: um agendamento só e o mesmo redirect')` (Review Focus 4), `test('horário tomado por outro cliente entre escolher e confirmar: message "Esse horário acabou de ser ocupado. Escolha outro." e conflict.nearest')` (Review Focus 4), `test('gato com gatos desligados → "A loja não atende gatos no momento."')`, `test('conta sem autoConfirm: feito mostra "Pedido de horário enviado"')`, `test('remarcar para horário livre grava e leva a feito?remarcado=1')`, `test('21ª marcação em 60 s → muitas tentativas')`. `cliente-ics-route.test.ts`: `test('cliente baixa o .ics do próprio horário com DTSTART em UTC')`, `test('id de outro cliente → 404')` (Review Focus 2), `test('id de agendamento de outra loja pelo slug desta → 404')` (Review Focus 1), `test('sem sessão → 404')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: confirmar horário, tela de sucesso e .ics`.

### Tarefa 12: Início

**Files:**
- Create: `src/app/app/[slug]/_inicio/{Inicio,HeroiProximo,AgendarDeNovo,Banners,SeusPets}.tsx`, `tests/unit/ui/cliente-inicio.test.tsx`
- Modify: `src/app/app/[slug]/page.tsx` (cliente → `Inicio`), `src/app/app/[slug]/loading.tsx` (`ClienteSkeleton variant="inicio"`), `src/ui/format.ts` (`relativeDayLabel`)
- Test: `tests/unit/format.test.ts` (ou o teste existente de `format.ts`)

**Interfaces:**
- `relativeDayLabel(date: string, today: string): string` — "Hoje", "Amanhã", senão "sáb., 29 de nov." (mês e dia da semana abreviados, minúsculas).
- `Inicio({ slug, home: CustomerHome, storefront: Storefront, today: string, cancelar })` — ordem: saudação "Oi, <firstName>" (`--text-h2`); `HeroiProximo`; `AgendarDeNovo` (linha "Agendar de novo" + "<serviços> para <pet> com <profissional ou 'qualquer profissional'>" → `/<slug>/agendar<query>`); `Banners` (rolagem com `scroll-snap`, imagem 16:9, `alt` = título, link só `https` ou caminho da loja); `SeusPets` (avatares redondos com nome → `/pets/<id>`, "+" → quiz); linha de pontos `pointsText(points)` → `/premios` (só com `points !== null`).
- `HeroiProximo({ next, slug, today, storefront, cancelar })`: bloco `--radius-block` em `--brand`/`--on-brand` com `Bubbles on="brand"`; nome do pet em `--text-h1`; `relativeDayLabel` + hora; serviços e profissional; selo "Aguardando a loja confirmar" para `PENDING`; com `change.allowed`: "Remarcar" (→ `/horarios/<id>/remarcar`) e "Cancelar horário" (`ConfirmDialog` "Cancelar o horário de Thor?" / "Cancelar horário" / "Manter horário", ação da Tarefa 13); sem: "O prazo para mudar por aqui terminou em <untilLabel>." + telefone da loja. Sem próximo: `EmptyIllustration horarios`, "Nenhum horário marcado", botão "Agendar" em `--surface`.

- [ ] **Step 1: Testes que falham.** `format.test.ts`: `relativeDayLabel('2026-11-25','2026-11-25') === 'Hoje'`, `('2026-11-26', …) === 'Amanhã'`, `('2026-11-29', '2026-11-25') === 'sáb., 29 de nov.'`. `cliente-inicio.test.tsx`: `test('herói com nome do pet, "Amanhã" e a hora')`, `test('dentro do prazo mostra Remarcar e Cancelar horário; fora mostra o prazo e o telefone')`, `test('pendente mostra "Aguardando a loja confirmar"')`, `test('sem próximo: "Nenhum horário marcado" e Agendar')`, `test('Agendar de novo leva a /a/agendar?pet=…&servicos=…')`, `test('points null esconde a linha de pontos; banners vazios não renderizam a faixa')`, `test('as bolhas do herói são aria-hidden')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: Início do cliente com o próximo horário em destaque`.

### Tarefa 13: Meus horários

**Files:**
- Create: `src/app/app/[slug]/horarios/{page,loading,actions}.tsx`, `src/app/app/[slug]/horarios/[id]/{page,loading}.tsx`, `src/app/app/[slug]/horarios/[id]/remarcar/{page,loading}.tsx`, `src/app/app/[slug]/horarios/_lib/HorarioLinha.tsx`, `tests/integration/cliente-horarios-actions.test.ts`, `tests/unit/ui/cliente-horarios.test.tsx`

**Interfaces:**
- `/horarios` (`searchParams: { ver?: 'anteriores'; depois?: string }`): `NavTabs` "Próximos" | "Anteriores"; `listCustomerAppointments(v.ctx, { scope, cursor: depois })`; linhas `HorarioLinha` (data com `relativeDayLabel`, hora `tabular-nums`, pet, serviços, profissional, `AppointmentStatusBadge`) agrupadas por mês nos anteriores; "Carregar mais" = link com `?depois=<nextCursor>`; vazios: próximos "Nenhum horário marcado" + "Agendar", anteriores "Seus horários anteriores aparecem aqui.".
- `/horarios/[id]`: `getAppointment` (alheio → `notFound()`); detalhes, total, recado; ações dentro do prazo: "Remarcar", "Cancelar horário" (`ConfirmDialog`), "Adicionar à minha agenda"; fora do prazo: `role="note"` "O prazo para mudar por aqui terminou em <untilLabel>. Fale com a loja:" + telefone/WhatsApp de `getStorefront`.
- `/horarios/[id]/remarcar`: `AgendarFluxo` em `modo='remarcar'` com pet, serviços e profissional do agendamento e `rescheduling=<id>`; fora do prazo → `redirect('/<slug>/horarios/<id>')`.
- `cancelarHorario = clienteAction(...)` lê `appointmentId`; `cancelAppointment(v.ctx, id, { reason: null })`; sucesso → `redirect('/<slug>/horarios?cancelado=1')` (toast "Horário cancelado."); recusa de prazo → mensagem do domínio + " Fale com a loja: <telefone>." quando houver telefone.

- [ ] **Step 1: Testes que falham.** `cliente-horarios-actions.test.ts`: `test('cancela o próprio horário dentro do prazo')`, `test('depois do prazo: recusa com o prazo e o telefone da loja, nada muda')` (Review Focus 5), `test('horário de outro cliente → não encontrado e nada muda')` (Review Focus 2), `test('id de agendamento da loja A enviado pelo slug de B → não encontrado')` (Review Focus 1), `test('cliente arquivado entre abrir e cancelar → redirect para /a?volta=%2Fa')` (Review Focus 5), `test('lista de anteriores pagina pelo cursor sem repetir')`. `cliente-horarios.test.tsx`: `test('linha mostra pet, hora e situação; encaixe nunca aparece como palavra')`, `test('vazio dos próximos convida a agendar')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: Meus horários com cancelar e remarcar no prazo`.

**G4 termina:** `npm run typecheck && npx vitest run <testes tocados em 10–13>`.

---

## G5 — Prêmios e Loja

### Tarefa 14: Prêmios

**Files:**
- Create: `src/app/app/[slug]/premios/{page,loading,actions}.tsx`, `src/app/app/[slug]/premios/extrato/{page,loading}.tsx`, `src/app/app/[slug]/premios/_lib/{Saldo,PremioCartao,Resgates}.tsx`, `tests/integration/cliente-premios-actions.test.ts`, `tests/unit/ui/cliente-premios.test.tsx`

**Interfaces:**
- Página: módulo `loyalty` desligado → `ModuloDesligado`. Conteúdo: `Saldo` (bloco `--radius-block` em `--accent-tint`, número em `--text-h1` `tabular-nums`, `pointsText`, "Você é do Clube" quando `clubMember`); "Seus resgates" pendentes (`listRedemptions` `status: 'PENDING'`) com "Retire no balcão." e "Cancelar resgate"; "Prêmios" em grade (imagem, nome, custo, estoque "Últimas 3 unidades" quando ≤ 3; sem saldo: botão desabilitado com "Faltam 40 pontos"); ranking (`getLoyaltySettings().rankingEnabled` → `getRanking`) como lista curta com a posição do cliente; link "Ver extrato".
- `/premios/extrato`: `listLoyaltyEntries(v.ctx, v.customerId, { cursor })` em linhas (+/−, motivo, data), "Carregar mais".
- `resgatarPremio = clienteAction(...)` lê `prizeId`, `expectedCostPoints`, `key`; `assertCustomerRate(v, 'redeem')`; `redeemPrize(v.ctx, { prizeId, expectedCostPoints, idempotencyKey: key })` → estado `ok` "Resgate pedido. Retire no balcão." (a página revalida). `cancelarResgate` → `cancelRedemption(v.ctx, id)`. Confirmação por `ConfirmDialog`: "Resgatar <prêmio> por <n> pontos? Seu saldo fica em <m>.".

- [ ] **Step 1: Testes que falham.** `cliente-premios-actions.test.ts`: `test('resgata e o saldo cai; resgate pendente aparece')`, `test('custo mudou desde a tela (expectedCostPoints) → mensagem do domínio, nada muda')`, `test('saldo insuficiente → mensagem')`, `test('cancelar resgate de outro cliente → não encontrado')` (Review Focus 2), `test('mesma key duas vezes: um resgate')`, `test('módulo desligado → mensagem de módulo')`. `cliente-premios.test.tsx`: `test('sem saldo: "Faltam 40 pontos" e botão desabilitado')`, `test('saldo 1 → "1 ponto"')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: Prêmios na área do cliente`.

### Tarefa 15: Loja — vitrine, produto e carrinho

**Files:**
- Create: `src/app/app/[slug]/loja/{page,loading,actions}.tsx`, `src/app/app/[slug]/loja/produto/[id]/{page,loading}.tsx`, `src/app/app/[slug]/loja/carrinho/{page,loading}.tsx`, `src/app/app/[slug]/loja/_lib/{carrinho.ts,ProdutoCartao.tsx,Quantidade.tsx}`, `tests/unit/cliente-carrinho.test.ts`, `tests/integration/cliente-loja-actions.test.ts`

**Interfaces:**
- `carrinho.ts` (servidor): `CART_COOKIE = 'af_carrinho'`; `readCart(slug: string): Promise<RawCartLine[]>` (JSON inválido → vazio; passa por `normalizeLines`; até `MAX_LINES`); `writeCart(slug: string, lines: RawCartLine[]): Promise<void>` (`httpOnly`, `SameSite=Lax`, `Secure` em produção, `Path=/<slug>`, `Max-Age` 30 dias; vazio apaga); `parseCartCookie(raw: string | undefined): RawCartLine[]` (pura, testada).
- `/loja`: módulo `store` desligado → `ModuloDesligado`; chips de categoria (`?categoria=`, `listCategories`), grade de `ProdutoCartao` (`listPublicProducts`: imagem 1:1, nome, preço, "Esgotado"); ícone do carrinho com contador no cabeçalho da página; vazio: "A loja ainda não tem produtos à venda." com `EmptyIllustration carrinho`.
- `/loja/produto/[id]`: `getPublicProduct` (inexistente → `notFound()`); imagens em rolagem com `scroll-snap` e indicador; descrição; `Quantidade` (− / número / +, 1 até o estoque e `MAX_PER_ORDER_LINE`); "Pôr no carrinho".
- `/loja/carrinho`: `priceCart(v.ctx, readCart(slug))`; linhas com `Quantidade` e "Tirar"; avisos do preçamento (item sem estoque/indisponível) em `role="alert"`; subtotal; "Continuar" → `/loja/finalizar`; links "Meus pedidos" e "Continuar comprando"; vazio com convite à vitrine.
- Ações: `porNoCarrinho(slug, prev, fd)` (`productId`, `quantity`; confere o produto por `getPublicProduct` antes de gravar), `mudarQuantidade`, `tirarDoCarrinho` — todas por `clienteAction`; toast "Pôs <produto> no carrinho." com link "Ver carrinho".

- [ ] **Step 1: Testes que falham.** `cliente-carrinho.test.ts`: `parseCartCookie` com JSON quebrado → `[]`; linhas repetidas somadas por `normalizeLines`; 25 linhas → 20; quantidade 0 ou negativa sai. `cliente-loja-actions.test.ts`: `test('pôr no carrinho grava o cookie com o caminho da loja')`, `test('produto arquivado ou de outra loja → "Produto não encontrado." e cookie intacto')` (Review Focus 1), `test('mudar quantidade além do estoque → mensagem do domínio')`, `test('módulo loja desligado → mensagem de módulo')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: vitrine, produto e carrinho da loja do cliente`.

### Tarefa 16: Loja — endereço, frete, pagamento e pedidos

**Files:**
- Create: `src/app/app/[slug]/loja/finalizar/{page,loading,FinalizarForm}.tsx`, `src/app/app/[slug]/loja/enderecos/{page,loading,EnderecoForm}.tsx`, `src/app/app/[slug]/loja/pedidos/{page,loading}.tsx`, `src/app/app/[slug]/loja/pedidos/[id]/{page,loading}.tsx`, `src/app/app/[slug]/loja/consultas.ts`, `src/app/app/[slug]/loja/pedidos/actions.ts`, `tests/integration/cliente-checkout-actions.test.ts`, `tests/unit/ui/cliente-finalizar.test.tsx`

**Interfaces:**
- `consultas.ts` (`'use server'`): `buscarCep(slug: string, cep: string): Promise<Pedido<{ endereco: { street: string; district: string; city: string; state: string } | null }>>` (`assertCustomerRate(…, 'postalCode')`, `lookupPostalCode`); `cotarFrete(slug: string, addressId: string): Promise<Pedido<{ cotacao: ShippingQuote }>>` (`'shippingQuote'`, `quoteShipping(v.ctx, { addressId, lines: readCart(slug) })`).
- `/loja/finalizar`: carrinho vazio → `redirect('/<slug>/loja/carrinho')`; `getStoreOptions`; pagamento indisponível → aviso "A loja ainda não recebe pagamento por aqui. Fale com a loja." e botão desabilitado. `FinalizarForm`: "Como receber" (`ChoiceCard`: "Retirar na loja" + instruções; "Entregar no endereço" quando `shipping.enabled`); entrega: endereços salvos (`listAddresses`) como `ChoiceCard` + "Novo endereço" (formulário em `Sheet` com CEP que preenche pelo `buscarCep`), opções de frete da cotação (`ChoiceCard`: transportadora, prazo "até 5 dias úteis", preço; `shippingError` em texto); "Recado" opcional; resumo com itens, frete e total; botão "Ir para o pagamento".
- `fazerPedido = clienteAction(...)`: lê `delivery` (`PICKUP` | `SHIPPING` + `addressId` + `quoteToken`), `note`, `key`; `assertCustomerRate(v, 'order')`; `createOrder(v.ctx, { lines: readCart(slug), delivery, note, idempotencyKey: key })`; `writeCart(slug, [])`; `startCheckout(v.ctx, order.id, { backPath: '/<slug>/loja/pedidos/<id>' })` → `redirect(checkoutUrl)`; `payment_unavailable` → `redirect('/<slug>/loja/pedidos/<id>?pagamento=indisponivel')` (o pedido fica aguardando).
- `/loja/enderecos`: lista (`isDefault` marcado), editar, apagar (`ConfirmDialog`), novo; ações `salvarEndereco` (`createAddress`/`updateAddress`), `apagarEndereco` (`deleteAddress`).
- `/loja/pedidos`: `listOrders(v.ctx, { cursor })` em linhas (número, data, total, `OrderStatusBadge`), "Carregar mais"; vazio com `EmptyIllustration pedidos`.
- `/loja/pedidos/[id]` (`searchParams` do Mercado Pago, ex. `status`, `collection_status`, `pagamento`): com qualquer um deles e pedido aguardando → `refreshMyOrderPayment(v.ctx, id)`; sem → `getOrder`; mostra situação (pago: "Pagamento confirmado."; aguardando: "Aguardando o pagamento até <expiresLabel>." + "Pagar agora"; cancelado: motivo), itens, entrega (retirada com instruções ou endereço + rastreio), totais; "Cancelar pedido" quando `canCancel`. Ações em `pedidos/actions.ts`: `pagarPedido` (`startCheckout` → `redirect(checkoutUrl)`), `cancelarPedido` (`cancelOrder`).

- [ ] **Step 1: Testes que falham.** `cliente-checkout-actions.test.ts` (Mercado Pago e Frenet falsos): `test('retirada: cria o pedido, limpa o carrinho e redireciona para o checkout com backPath do pedido')`, `test('entrega com quoteToken da cotação grava o frete')`, `test('quoteToken adulterado → mensagem do domínio, nada criado')`, `test('cotarFrete com endereço de outro cliente → não encontrado')` (Review Focus 2), `test('pagarPedido e cancelarPedido de pedido de outro cliente → não encontrado')` (Review Focus 2), `test('pagamento indisponível: pedido aguardando e redirect com ?pagamento=indisponivel')`, `test('mesma key duas vezes: um pedido')`, `test('salvarEndereco e apagarEndereco só nos próprios')`. `cliente-finalizar.test.tsx`: `test('sem entrega ligada só aparece "Retirar na loja"')`, `test('pagamento indisponível desabilita "Ir para o pagamento" e mostra o aviso')`, `test('CEP preenche rua, bairro, cidade e estado')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: endereço, frete, pagamento e pedidos da loja do cliente`.

**G5 termina:** `npm run typecheck && npx vitest run <testes tocados em 14–16>`.

---

## G6 — Mais, acabamento e verificação

### Tarefa 17: Mais e a conta nesta loja

**Files:**
- Create: `src/app/app/[slug]/mais/{actions.ts,AvisosForm.tsx}`, `src/app/app/[slug]/mais/excluir/{page,loading,ExcluirForm}.tsx`, `tests/integration/cliente-mais-actions.test.ts`
- Modify: `src/app/app/[slug]/mais/page.tsx`

**Interfaces:**
- `/mais` (cliente): cabeçalho com nome e e-mail da pessoa; itens `maisItems`; "Avisos por e-mail" (`AvisosForm`: `Switch` "Lembretes e mudanças dos seus horários" e "Novidades da loja", `getNotificationPreferences` / `updateNotificationPreferences`, "Avisos salvos."); "Trocar de loja" (só com duas ou mais lojas → `/conta#lojas`); "Abrir painel" (`isStaff`); "Sair" (ação da fase 1); "Excluir minha conta nesta loja" (link discreto em `--danger` → `/mais/excluir`); rodapé "feito com Agenda Flui".
- `/mais/excluir`: texto "Seus dados nesta loja são apagados e os horários futuros, cancelados. Se você não usa o Agenda Flui em outra loja, sua conta também é apagada."; com senha: campo "Sua senha"; só Google: campo "Digite excluir para confirmar"; botão `danger` "Excluir minha conta nesta loja".
- `excluirConta = clienteAction(...)`: `deleteStoreAccount({ userId, businessId, customerId, password, confirm, sessionToken }, meta, now)`; `personDeleted` → apaga o cookie `APP_COOKIE`; `redirect(nextPath)`. `/entrar?conta=excluida` mostra "Sua conta foi excluída." (mudança de uma linha na tela de entrada da fase 1).
- `salvarAvisos = clienteAction(...)` → `updateNotificationPreferences(v.ctx, { emailAppointments, emailMarketing })`.

- [ ] **Step 1: Testes que falham.** `cliente-mais-actions.test.ts`: `test('salvarAvisos grava só no cliente desta loja')`, `test('excluirConta com senha certa: pessoa de uma loja só apagada, cookie apagado, redirect /entrar?conta=excluida')`, `test('excluirConta com senha errada: fields.password e nada muda')`, `test('cliente de duas lojas: redirect para a outra loja e a pessoa continua')`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** testes + `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** `feat: Mais, avisos por e-mail e excluir conta na loja`.

### Tarefa 18: Acabamento, varreduras e verificação completa

**Files:**
- Create: `tests/unit/cliente-acabamento.test.ts`
- Modify: `tests/unit/loading-pages.test.tsx` (rotas do cliente com `ClienteSkeleton`), `scripts/smoke-pages.ts`, `docs/superpowers/pendencias-proximas-fases.md`, `docs/ARQUITETURA.md` (só a linha da área do cliente: guarda `requireCustomer`/`resolveStoreVisit`, carrinho em cookie, nenhuma trava nova)

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Testes que falham.** `loading-pages.test.tsx`: para cada rota com dado em `src/app/app/[slug]` (`''`, `boas-vindas`, `agendar`, `agendar/feito/[id]`, `horarios`, `horarios/[id]`, `horarios/[id]/remarcar`, `pets`, `pets/[petId]`, `premios`, `premios/extrato`, `loja`, `loja/produto/[id]`, `loja/carrinho`, `loja/finalizar`, `loja/enderecos`, `loja/pedidos`, `loja/pedidos/[id]`, `mais`, `mais/excluir`) existe `loading.tsx` que contém `ClienteSkeleton` e anuncia "Carregando". `cliente-acabamento.test.ts` (com `arquivosCom`): nenhum `tutor|tosador|patinhas|API do app` em `src/app/app/[slug]` e `src/ui`; nenhum `width:` ou `min-width:` acima de 360 px fora de `@media` em `cliente.css`; toda regra com `animation`/`transition` de `cliente.css` está dentro de `@media (prefers-reduced-motion: no-preference)`; nenhum arquivo de `src/app/app/[slug]` importa `@/server/db/client`; toda `actions.ts` de `src/app/app/[slug]` usa `clienteAction` ou `requireCustomer`; nenhum `text-transform: uppercase` em `cliente.css`.
- [ ] **Step 2:** rodar → FAIL onde faltar; corrigir.
- [ ] **Step 3: Fumaça.** `scripts/smoke-pages.ts` ganha, no host do app, com a demo: `/demo` sem sessão (loja pública), `/demo/entrar`, `/demo/agendar` (sem sessão → 307 para entrar), `/nao-existe` (Loja indisponível) e, com sessão de cliente da demo, `/demo`, `/demo/agendar`, `/demo/horarios`, `/demo/pets`, `/demo/premios`, `/demo/loja`, `/demo/mais`, `/demo/boas-vindas?novo=1`. Rode `npm run smoke` com o banco local de pé; se não estiver, registre.
- [ ] **Step 4: Pendências.** `pendencias-proximas-fases.md`: marca a fase 3 entregue e lista o que o dono confere no celular (cadastro pela loja até o quiz, quiz com e sem gatos, agendar com "Qualquer um", horário tomado, sucesso e `.ics` no calendário do celular, remarcar perto do próprio horário, cancelar fora do prazo, Meus pets com gato e gatos desligados, Prêmios, Loja até o Mercado Pago de teste, excluir conta, 360 px, modo de movimento reduzido, cor de loja clara demais).
- [ ] **Step 5: Verificação completa.** `npm run typecheck && npm run lint && npm test && npm run build` → tudo verde, sem aviso novo.
- [ ] **Step 6: Commit** `test: varreduras de acabamento da área do cliente e pendências`.

**G6 termina** com a verificação completa do Step 5; depois, a revisão final única (Opus) sobre o ramo inteiro, guiada pela Review Focus.
