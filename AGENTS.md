<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

O bloco acima é gerenciado pelo `next dev`; o conteúdo abaixo é do projeto.

# AgendaFlui

Sistema de agendamento multi-conta (Next.js 16, TypeScript estrito, Prisma 7, PostgreSQL).
Spec: `docs/superpowers/specs/2026-11-13-agendaflui-design.md`; arquitetura em `docs/ARQUITETURA.md`; tempo em `docs/TEMPO.md`. Textos de interface em pt-BR.

## Hosts

Três hosts, todos vindos de variáveis de ambiente (nunca fixos no código):
`DEV_HOST` (painel da plataforma, usado por nós, os admins), `PAINEL_HOST` (painel do negócio, usado
por donos e equipes) e `API_HOST` (API do aplicativo).

## Regras

- Regra de negócio só em `src/server/`.
- Dados de conta só por `tenantDb`; o cliente Prisma cru (`@/server/db/client`) fica restrito às pastas liberadas no ESLint.
- Código de domínio (`src/server/domain/**`) recebe `ctx` e usa `ctx.db` e `ctx.clock()`; nunca o cliente Prisma cru nem `new Date()`.
- Esquemas de validação importam `z` de `@/server/domain/errors`, nunca de `zod`.
- Data e hora só por `src/server/time/`. Leia a spec antes de mexer em agenda ou fuso.
- Travas de concorrência só pela função única `$lockKey` (`lockKeyRaw` no domínio de plataforma; a exceção é a trava global dos admins em `domain/platform/admins.ts`), na ordem descrita em `docs/ARQUITETURA.md`.
- Segredos de integração só pelo leitor restrito `domain/platform/integration-secrets.ts` (só `domain/store/**` importa; o ESLint e `tests/unit/integration-secrets-imports.test.ts` conferem), e as chaves do Google só por `domain/platform/google-secrets.ts` (só `auth/google/**` importa; `tests/unit/google-secrets-imports.test.ts` confere).
- Módulo opcional: toda função de domínio chama `requireModule` (`module_disabled`).
- Hosts só por `hostConfigFromEnv` (`src/server/hosts.ts`).
- Sem `any` e sem `@ts-ignore`.
- Tabela nova: classifique o modelo em `src/server/db/models.ts`. Se for de conta, ela tem coluna
  `business_id` e FK composta com `business_id` para as outras tabelas de conta; o teste estrutural
  (`tests/integration/schema.test.ts`) confere.

## Verificação

`npm run typecheck && npm run lint && npm test && npm run build`
