# AgendaFlui

Sistema de agendamento para vários negócios (pet shops, barbearias, clínicas). Cada negócio é uma
conta com marca, termos e módulos próprios. Três endereços: o painel dev (quem administra a
plataforma), o painel do negócio (cada conta, com a marca dela) e a API.

## Requisitos

- Node 22.18 ou mais novo
- Nada de Docker nem Postgres instalado: o banco de desenvolvimento é embutido e fica em `.local/pg/`

## Como rodar

```bash
cp .env.example .env
npm install
npm run dev
```

O `npm run dev` sobe o banco, aplica as migrações, cria os dados de demonstração se o banco estiver
vazio e inicia o Next. Para parar, Ctrl+C (o banco também é encerrado).

| Área | Endereço |
|---|---|
| Painel dev | http://dev.localhost:3000 |
| Painel do negócio | http://painel.localhost:3000 |
| API | http://api.localhost:3000 |

O seed de demonstração não roda em produção, a menos que `SEED_ALLOW_PRODUCTION=1`. Se o `npm run dev`
avisar que os dados de demonstração ficaram incompletos, rode `npm run db:reset` e inicie de novo.

Os e-mails e as senhas de demonstração estão no `.env.example` (copiados para o seu `.env`).
Duas contas de exemplo: Patas & Cia (pet shop) e Navalha de Ouro (barbearia). Cada conta tem o
próprio link de entrada: `painel.localhost:3000/entrar/patas-e-cia`.
A vitrine de componentes fica em `dev.localhost:3000/vitrine`.

## API

- A documentação OpenAPI está em `/v1/openapi.json` no host da API (`http://api.localhost:3000/v1/openapi.json`).
- As chaves de app de demonstração (uma por conta e uma de plataforma) ficam em `.local/demo-keys.json`, criadas
  pelo seed; mande a chave no cabeçalho `X-App-Key`. Se o arquivo sumir, `npm run db:reset` recria tudo.
- Em desenvolvimento, e-mails caem em `.local/mail` e pushes em `.local/push`.
- Variáveis (veja `.env.example`): `TRUSTED_PROXY_HOPS`, `SMTP_URL`, `MAIL_FROM`, `EXPO_ACCESS_TOKEN`, `WORKER_ENABLED`.
- `npm run worker:once` roda uma rodada de envio de avisos e termina.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Banco, migrações, dados de demonstração e Next |
| `npm run db:start` | Só o banco local |
| `npm run db:migrate` | Aplica as migrações (o banco precisa estar no ar: `npm run db:start`) |
| `npm run db:seed` | Cria os dados e as chaves de demonstração (pode repetir sem duplicar) |
| `npm run db:reset` | Apaga o banco local e recria vazio |
| `npm run admin:create` | Cria um administrador da plataforma |
| `npm run typecheck` / `npm run lint` | Tipos e estilo |
| `npm test` / `npm run test:tz` | Testes unitários e de integração; datas em vários fusos |
| `npm run test:e2e` | Testes no navegador (sobem o `npm run dev` se preciso) |
| `npm run worker:once` | Uma rodada de envio de avisos |
| `npm run build` | Build de produção |

## Pastas

- `src/app/` rotas: `dev/` (painel dev), `painel/` (painel do negócio), `api/`, `arquivos/` (imagens enviadas)
- `src/server/` regra de negócio, dados, acesso e horários (`time/`)
- `src/ui/` design system, molduras e temas
- `prisma/` esquema, migrações e seed
- `scripts/` banco local, `npm run dev` e criação de administrador
- `tests/` unit, integration e e2e
- `docs/` spec e decisões
