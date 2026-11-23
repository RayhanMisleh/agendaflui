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
Duas contas de exemplo: Patas & Cia (pet shop) e Navalha de Ouro (barbearia). A equipe de todas as contas
entra pelo mesmo endereço: `painel.localhost:3000/entrar`.
A vitrine de componentes fica em `dev.localhost:3000/vitrine` (só para admin logado).

Publicação em produção (imagem Docker, Coolify): `docs/PUBLICACAO.md`.

## Painel dev

- Entre em `http://dev.localhost:3000` com `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` do seu `.env`
  (o seed cria esse admin). O seed também cria um admin desativado, uma conta suspensa, uso da API das
  últimas 48 horas, execuções do agendador e um aviso com falha, para as telas não aparecerem vazias.
- Sem o seed (por exemplo num banco novo), crie o primeiro admin com `npm run admin:create`.
- `npm run smoke` pede por HTTP cada tela do painel dev com uma sessão temporária de admin e falha se
  alguma não responder 200. Rode `npm run build` antes. Só roda em banco local (localhost): ela grava
  uma sessão de admin no banco e recusa qualquer outro endereço ou produção.

## Painel do negócio

- Entre em `http://painel.localhost:3000` (`/entrar`) com os e-mails de
  demonstração do `.env.example`: dono, gerente e profissional de cada conta.
- Cada conta de demonstração tem uma semana de agenda variada (concluídos, faltas, cancelado e confirmados),
  um bloqueio, um fechamento (feriado) e um cliente arquivado.
- O que cada papel vê depende da capacidade: o profissional só abre a própria agenda, os próprios números e
  o próprio perfil.
- `npm run smoke` também pede cada tela do painel do negócio, com uma sessão temporária de dono.

## Módulos e integrações

- Três módulos opcionais, ligados por conta na aba Módulos do painel dev: Fidelidade, Banners e Loja.
  Desligado, o módulo some do menu, das telas e da API (404) e os dados ficam guardados.
  A aba mostra o que está em andamento (pedidos a entregar e resgates) antes de desligar.
- Mercado Pago (pagamento) e Frenet (frete) são configurados por conta, só pelo admin, na aba Integrações do painel
  dev. Os segredos ficam cifrados e a tela mostra só os 4 últimos caracteres. O webhook do Mercado Pago é
  `POST /v1/webhooks/mercadopago/{chave da conta}` no host da API.
- `INTEGRATIONS_MODE` (`.env`): `fake` (padrão fora de produção) usa Mercado Pago, Frenet e ViaCEP falsos e liga
  "Simular pagamento aprovado" no pedido; em produção vale só `real`. Nenhum teste chama a rede.
- O seed dá à Navalha de Ouro todos os módulos (produtos, prêmios, banners e pedidos, com
  credenciais `TEST-…` falsas e cifradas) e à Patas & Cia prêmios e um banner.

## API

- A documentação OpenAPI está em `/v1/openapi.json` no host da API (`http://api.localhost:3000/v1/openapi.json`).
- A API serve só aos apps próprios: não há chave. Mande a conta no cabeçalho `X-Business` (o `slug`, ex.: `patas-e-cia`).
  No navegador, só as origens de `APP_WEB_ORIGINS` recebem CORS (localhost é liberado fora de produção).
- Em desenvolvimento, e-mails caem em `.local/mail` e pushes em `.local/push`.
- Variáveis (veja `.env.example`): `APP_WEB_ORIGINS`, `TRUSTED_PROXY_HOPS`, `SMTP_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `EXPO_ACCESS_TOKEN`, `WORKER_ENABLED`.
- `npm run worker:once` roda uma rodada de envio de avisos e termina.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Banco, migrações, dados de demonstração e Next |
| `npm run db:start` | Só o banco local |
| `npm run db:migrate` | Aplica as migrações (o banco precisa estar no ar: `npm run db:start`) |
| `npm run db:seed` | Cria os dados de demonstração (pode repetir sem duplicar) |
| `npm run db:reset` | Apaga o banco local e recria vazio |
| `npm run admin:create` | Cria um administrador da plataforma |
| `npm run smoke` | Fumaça por HTTP das telas dos dois painéis (só em banco local) |
| `npm run typecheck` / `npm run lint` | Tipos e estilo |
| `npm test` / `npm run test:tz` | Testes unitários e de integração; datas em vários fusos |
| `npm run test:e2e` | Testes no navegador (sobem o `npm run dev` se preciso; ainda não foram rodados, veja as pendências) |
| `npm run worker:once` | Uma rodada de envio de avisos |
| `npm run build` | Build de produção |

## Pastas

- `src/app/` rotas: `dev/` (painel dev), `painel/` (painel do negócio), `api/`, `arquivos/` (imagens enviadas)
- `src/server/` regra de negócio, dados, acesso e horários (`time/`)
- `src/ui/` design system, molduras e temas
- `prisma/` esquema, migrações e seed
- `scripts/` banco local, `npm run dev` e criação de administrador
- `tests/` unit, integration e e2e
- `docs/` documentação (abaixo)

## Documentação

- `docs/ARQUITETURA.md` camadas, endereços, isolamento entre contas, acesso, travas, fila de avisos
- `docs/TEMPO.md` regras de tempo e fuso, horário de verão
- `docs/PUBLICACAO.md` publicação em produção (Docker, Coolify, variáveis, backup)
- `docs/superpowers/specs/` spec do produto e direção de design
- `docs/superpowers/pendencias-proximas-fases.md` o que continua pendente
- `AGENTS.md` regras curtas para quem edita (pessoa ou IA)
- API: OpenAPI gerado em `/v1/openapi.json`
