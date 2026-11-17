# Publicação

Um contêiner Docker (`Dockerfile` na raiz), porta 3000, atrás de um proxy com TLS (Coolify/Traefik).

## Requisitos

- Postgres 17 ou mais novo, com a extensão `btree_gist` habilitada (a migração a cria se o usuário puder).
- Proxy que termina HTTPS, preserva o cabeçalho `Host` e acrescenta `X-Forwarded-For`.
- Um volume persistente montado em `/data/storage`.

## Variáveis

Lista completa, uma linha cada, no bloco "Produção" do `.env.example`. Obrigatórias: `DATABASE_URL`,
`APP_SECRET`, `DEV_HOST`, `PAINEL_HOST`, `API_HOST` (distintos, públicos, sem `https://`), `STORAGE_DIR`.
Atrás do proxy use `TRUSTED_PROXY_HOPS=1`: com 0 o IP do cliente é desconhecido (limites por IP desligados,
auditoria sem IP). Sem `SMTP_URL` o servidor sobe, mas convites e cadastro pelo app não chegam.
O servidor sempre usa HTTPS nos links e cookies `Secure` em produção: sem TLS no proxy o login não funciona.

## Banco

- `DIRECT_URL` (opcional) é a conexão direta, sem pooler: as migrações a usam quando existe. O servidor usa
  `DATABASE_URL`; com `DATABASE_USE_DIRECT_URL=true` usa a direta também (necessário se o pooler, em modo transação,
  não mantiver o fuso UTC; a partida confere isso e recusa com a orientação).
- O `sslmode` vem na própria URL fornecida pela plataforma e segue a semântica padrão do libpq: `sslmode=require`
  cifra sem validar a cadeia. Para validar, a URL deve trazer `sslmode=verify-full` e o certificado da autoridade
  precisa estar disponível ao Node (`NODE_EXTRA_CA_CERTS`). As migrações (motor do Prisma) usam a URL como vem.

## Como o contêiner parte

`scripts/start-production.ts`: valida o ambiente (sem imprimir valores) e a pasta de armazenamento, espera o banco
(até cerca de 60 s), confere fuso/travas/`btree_gist`, roda `prisma migrate deploy` (duas instâncias juntas são seguras: o
Prisma usa trava consultiva do Postgres) e inicia o Next, repassando `SIGTERM`. `MIGRATE_ON_START=false` pula a migração.

## Saúde

`GET /healthz` em qualquer host: 200 `{"status":"ok"}`, ou 503 `{"status":"degraded"}` se o banco não responder em 2 s.

## Primeiro admin

No terminal do contêiner (Coolify): `npm run admin:create`. Pergunta nome, e-mail e senha (digitada, não aparece).

## Backup e restauração

- Banco: `pg_dump --format=custom "$DATABASE_URL" > agendaflui.dump` (use a URL direta se houver pooler).
- Arquivos: copie `/data/storage` (`tar czf storage.tgz -C /data storage`).
- Restaurar: banco vazio, `pg_restore --no-owner -d "$DATABASE_URL" agendaflui.dump`, e `tar xzf storage.tgz -C /data`.

## Atualização

Novo deploy: a partida aplica as migrações novas antes de servir.

## Não faça

- Rodar o seed de demonstração (recusa em produção sem `SEED_ALLOW_PRODUCTION=1`; não use).
- Subir mais de uma instância sem `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` fixa (base64 de 32 bytes, também no build).

## Coolify

Build por Dockerfile; porta 3000; os três domínios no mesmo recurso (`dev.`, `painel.`, `api.`); armazenamento
persistente em `/data/storage`; variáveis acima; verificação de saúde em `/healthz` (o Coolify roda `curl` dentro do
contêiner; a imagem já o traz). O Coolify injeta as variáveis da aplicação também no build: o Dockerfile já conta
com isso. Ao acrescentar um domínio depois de criada a aplicação, confira em General > Container > Labels se há
uma regra `Host(...)` para ele; se faltar, use "Reset To Defaults" e reimplante (sem isso o proxy responde 503).
