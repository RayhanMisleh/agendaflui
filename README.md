# AgendaFlui

Sistema de agendamento web para negócios de serviço, hoje só para pet shops. Cada negócio é uma
conta com marca e módulos próprios. Dois endereços: o painel dev (quem administra a plataforma) e o
Agenda Flui (`APP_HOST`): entrada, painel da loja, área do cliente e Minha conta, com uma conta por
pessoa (senha e/ou Google).

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
| Agenda Flui (entrada, painel, clientes) | http://app.localhost:3000 |

O seed de demonstração não roda em produção, a menos que `SEED_ALLOW_PRODUCTION=1`. Se o `npm run dev`
avisar que os dados de demonstração ficaram incompletos, rode `npm run db:reset` e inicie de novo.

Os e-mails e as senhas de demonstração estão no `.env.example` (copiados para o seu `.env`).
Duas contas de exemplo: Patas & Cia e Navalha de Ouro. Para uma loja pet completa, use `npm run demo:create`. Todos entram pelo mesmo
endereço: `app.localhost:3000/entrar`. A área do cliente de cada loja fica em `app.localhost:3000/<identificador>`.
A vitrine de componentes fica em `dev.localhost:3000/vitrine` (só para admin logado).

Publicação em produção (imagem Docker, Coolify): `docs/PUBLICACAO.md`.

## Painel dev

- Entre em `http://dev.localhost:3000` com `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` do seu `.env`
  (o seed cria esse admin). O seed também cria um admin desativado, uma conta suspensa, execuções do agendador e um aviso com falha, para as telas não aparecerem vazias.
- Sem o seed (por exemplo num banco novo), crie o primeiro admin com `npm run admin:create`.
- `npm run smoke` pede por HTTP cada tela do painel dev com uma sessão temporária de admin e falha se
  alguma não responder 200. Rode `npm run build` antes. Só roda em banco local (localhost): ela grava
  uma sessão de admin no banco e recusa qualquer outro endereço ou produção.

## Painel do negócio

- Entre em `http://app.localhost:3000/entrar` com os e-mails de
  demonstração do `.env.example`: dono, gerente e profissional de cada conta. Com `INTEGRATIONS_MODE=fake`, `/google/falso`
  simula a tela do Google para testar o "Entrar com Google".
- Cada conta de demonstração tem uma semana de agenda variada (concluídos, faltas, cancelado e confirmados),
  um bloqueio, um fechamento (feriado) e um cliente arquivado.
- O que cada papel vê depende da capacidade: o profissional só abre a própria agenda, os próprios números e
  o próprio perfil.
- `npm run smoke` também pede cada tela do app, com uma sessão temporária de dono.

## Módulos e integrações

- Três módulos opcionais, ligados por conta na aba Módulos do painel dev: Fidelidade, Banners e Loja.
  Desligado, o módulo some do menu e das telas (404) e os dados ficam guardados.
  A aba mostra o que está em andamento (pedidos a entregar e resgates) antes de desligar.
- Mercado Pago (pagamento) e Frenet (frete) são configurados por conta, só pelo admin, na aba Integrações do painel
  dev. Os segredos ficam cifrados e a tela mostra só os 4 últimos caracteres. O webhook do Mercado Pago é
  `POST /webhooks/mercadopago/{chave da conta}` no `APP_HOST`.
- `INTEGRATIONS_MODE` (`.env`): `fake` (padrão fora de produção) usa Mercado Pago, Frenet e ViaCEP falsos e liga
  "Simular pagamento aprovado" no pedido; em produção vale só `real`. Nenhum teste chama a rede.
- O seed dá à Navalha de Ouro todos os módulos (produtos, prêmios, banners e pedidos, com
  credenciais `TEST-…` falsas e cifradas) e à Patas & Cia prêmios e um banner.

## Ambiente

- Em desenvolvimento, os e-mails caem em `.local/mail`.
- Variáveis (veja `.env.example`): `DEV_HOST`, `APP_HOST`, `LEGACY_PAINEL_HOST`, `TRUSTED_PROXY_HOPS`, `SMTP_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `WORKER_ENABLED`.
- As chaves do Google (ID e segredo do cliente OAuth) ficam no painel dev, em Sistema → Google; o passo a passo está em `docs/PUBLICACAO.md`.
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
| `npm run demo:create` | Cria a conta de demonstração "Focinho Feliz Pet Shop" (também em produção) |
| `npm run smoke` | Fumaça por HTTP das telas do painel dev e do app (só em banco local) |
| `npm run typecheck` / `npm run lint` | Tipos e estilo |
| `npm test` / `npm run test:tz` | Testes unitários e de integração; datas em vários fusos |
| `npm run worker:once` | Uma rodada de envio de avisos |
| `npm run build` | Build de produção |

## Pastas

- `src/app/` rotas: `dev/` (painel dev), `app/` (entrada, `painel/`, `[slug]/`, `conta/`), `arquivos/` (imagens enviadas)
- `src/server/` regra de negócio, dados, acesso e horários (`time/`)
- `src/ui/` design system, molduras e temas
- `prisma/` esquema, migrações e seed
- `scripts/` banco local, `npm run dev` e criação de administrador
- `tests/` unit e integration
- `docs/` documentação (abaixo)

## Documentação

- `docs/PRODUTO.md` o produto: públicos, rotas, contas, Google, agenda, nicho pet, módulos, avisos
- `docs/ARQUITETURA.md` camadas, endereços, isolamento entre contas, pessoa e acesso, travas, fila, Google Agenda, interface
- `docs/TEMPO.md` regras de tempo e fuso, horário de verão
- `docs/PUBLICACAO.md` publicação em produção (Docker, Coolify, variáveis, Google Cloud, backup)
- `docs/PENDENCIAS.md` o que está aberto
- `AGENTS.md` regras curtas para quem edita (pessoa ou IA)
