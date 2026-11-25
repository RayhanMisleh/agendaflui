<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

O bloco acima é gerenciado pelo `next dev`; o conteúdo abaixo é do projeto.

# AgendaFlui

Sistema de agendamento web multi-conta, hoje só para pet shops (Next.js 16, TypeScript estrito, Prisma 7, PostgreSQL).
Textos de interface em pt-BR. Leia antes de mexer:

- `docs/PRODUTO.md`: o produto (públicos, rotas, contas, Google, agenda, nicho pet, módulos, avisos).
- `docs/ARQUITETURA.md`: camadas, hosts, isolamento, acesso, travas, fila, Google Agenda, interface.
- `docs/TEMPO.md`: data, hora e fuso.
- `docs/PUBLICACAO.md`: produção (Coolify, variáveis, Google Cloud, Mercado Pago).
- `docs/PENDENCIAS.md`: o que está aberto.
- `README.md`: rodar localmente e comandos.

## Hosts

Dois hosts, vindos de variáveis de ambiente (nunca fixos no código): `DEV_HOST` (painel da plataforma,
usado por nós, os admins) e `APP_HOST` (o Agenda Flui de donos, equipes e clientes: entrada, `/painel/**`,
`/<slug>/**` e Minha conta). `LEGACY_PAINEL_HOST`, opcional, só redireciona (308) o endereço antigo do painel.

## Regras

- Regra de negócio só em `src/server/`.
- Dados de conta só por `tenantDb`; o cliente Prisma cru (`@/server/db/client`) fica restrito às pastas liberadas no ESLint.
- Código de domínio (`src/server/domain/**`) recebe `ctx` e usa `ctx.db` e `ctx.clock()`; nunca o cliente Prisma cru nem `new Date()`.
- Esquemas de validação importam `z` de `@/server/domain/errors`, nunca de `zod`.
- Data e hora só por `src/server/time/`. Leia `docs/TEMPO.md` antes de mexer em agenda ou fuso.
- Travas de concorrência só pela função única `$lockKey` (`lockKeyRaw` no domínio de plataforma; a exceção é a trava global dos admins em `domain/platform/admins.ts`), na ordem descrita em `docs/ARQUITETURA.md`.
- Segredos de integração só pelo leitor restrito `domain/platform/integration-secrets.ts` (só `domain/store/**` importa; o ESLint e `tests/unit/integration-secrets-imports.test.ts` conferem), e as chaves do Google só por `domain/platform/google-secrets.ts` (só `auth/google/**` importa; o embrulho `auth/google/config.ts`, só `auth/google/**` e `src/server/calendar/**`; `tests/unit/google-secrets-imports.test.ts` confere), e o token da agenda do Google só por `calendar/token.ts` (só `src/server/calendar/**` importa; `tests/unit/calendar-token-imports.test.ts` confere).
- Módulo opcional: toda função de domínio chama `requireModule` (`module_disabled`).
- Hosts só por `hostConfigFromEnv` (`src/server/hosts.ts`).
- Sem `any` e sem `@ts-ignore`.
- Tabela nova: classifique o modelo em `src/server/db/models.ts`. Se for de conta, ela tem coluna
  `business_id` e FK composta com `business_id` para as outras tabelas de conta; o teste estrutural
  (`tests/integration/schema.test.ts`) confere.
- Interface: a moldura fica no `layout.tsx`; a página desenha só o miolo (`ShellPage`, `AccountPage` ou `ClientePagina`) e o
  `loading.tsx`, só o esqueleto do miolo. Componentes em `src/ui/components` (exportados por `index.ts`).
- Docs só com o estado atual: sem histórico, fases nem planos. Mudou o comportamento, atualize o doc correspondente.

## Pastas

- `src/app/`: rotas. `dev/` (painel dev), `app/` (`(entrada)`, `painel/`, `[slug]/(acesso)` e `[slug]/(area)`, `conta/`,
  `google/`, `suporte/`, `webhooks/`), `arquivos/`, `healthz/`, `_lib/` (apoio das telas).
- `src/server/`: `domain/` (regra de negócio por assunto), `auth/` (pessoa, sessão, papéis, Google), `db/` (Prisma,
  `tenantDb`, modelos), `time/`, `niches/`, `calendar/` (envio ao Google Agenda), `notifications/` (e-mail e agendador),
  `integrations/` (Mercado Pago, Frenet, ViaCEP, Google), `storage/` (arquivos), `env.ts`, `hosts.ts`.
- `src/ui/`: componentes, molduras (`shells/`), temas e estilos. `src/shared/`: código sem servidor.
- `prisma/` (schema, migrações, seed), `scripts/` (dev, banco local, partida de produção, admin, demo, fumaça),
  `tests/unit` e `tests/integration`.

## Verificação

`npm run typecheck && npm run lint && npm test && npm run build`
