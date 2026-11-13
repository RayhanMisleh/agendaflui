<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

O bloco acima é gerenciado pelo `next dev`; o conteúdo abaixo é do projeto.

# AgendaFlui

Sistema de agendamento multi-conta (Next.js 16, TypeScript estrito, Prisma 7, PostgreSQL).
Spec: `docs/superpowers/specs/2026-11-13-agendaflui-design.md`. Textos de interface em pt-BR.

## Hosts

Três hosts, todos vindos de variáveis de ambiente (nunca fixos no código):
`DEV_HOST` (painel da plataforma, usado por nós, os admins), `PAINEL_HOST` (painel do negócio, usado
por donos e equipes) e `API_HOST` (API do aplicativo).

## Regras

- Regra de negócio só em `src/server/`.
- Dados de conta só por `tenantDb`; o cliente Prisma cru (`@/server/db/client`) fica restrito às pastas liberadas no ESLint.
- Data e hora só por `src/server/time/`. Leia a spec antes de mexer em agenda ou fuso.
- Sem `any` e sem `@ts-ignore`.
- Tabela nova: classifique o modelo em `src/server/db/models.ts`. Se for de conta, ela tem coluna
  `business_id` e FK composta com `business_id` para as outras tabelas de conta; o teste estrutural
  (`tests/integration/schema.test.ts`) confere.

## Verificação

`npm run typecheck && npm run lint && npm test && npm run build`
