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
auditoria sem IP). A partida avisa no log quando `TRUSTED_PROXY_HOPS` é 0, quando falta `SMTP_URL` e quando falta
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`. O proxy precisa preservar o `Host` original: as rotas POST do painel dev conferem
`Origin == Host`, e o roteamento por host também usa o `Host` (nunca `X-Forwarded-Host`); se o proxy reescrever o
`Host`, essas rotas recusam o envio. Sem `SMTP_URL` o servidor sobe, mas convites e cadastro pelo app não chegam.
`INTEGRATIONS_MODE` (opcional) escolhe as integrações externas (Mercado Pago, Frenet e ViaCEP): `real` ou `fake`. Em
produção o padrão é `real`: deixe a variável de fora ou use `real`. `fake` só vale em desenvolvimento e teste; em
produção ele impede a partida.
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64 de 32 bytes, ex.: `openssl rand -base64 32`) fixa a chave das Server Actions. Com
uma só instância é opcional; com várias é obrigatória, a mesma em todas. Ela fica gravada na saída do build, então precisa estar disponível no build (build arg, que o Dockerfile declara) e na execução (o Coolify a injeta nos dois).
Em produção o servidor manda `Strict-Transport-Security` (1 ano, com subdomínios): não ligue o HSTS de novo no proxy com valor diferente.
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

## Retenção

O agendador roda uma vez por dia, em lotes pequenos, a limpeza de avisos terminados com mais de 90 dias, uso da API com mais de 400 dias
e auditoria com mais de 2 anos (prazos em `src/server/db/retention.ts`). A execução aparece em /sistema como "Retenção de dados".

## Saúde

`GET /healthz` em qualquer host: 200 `{"status":"ok"}`, ou 503 `{"status":"degraded"}` se o banco não responder em 2 s.

## Primeiro admin

No terminal do contêiner (Coolify): `npm run admin:create`. Pergunta nome, e-mail e senha (digitada, não aparece).

## Conta de demonstração

No terminal do contêiner: `npm run demo:create`. Cria a conta fictícia "Pet Shop Demonstração" (identificador `demo`,
dono `demo@agendaflui.com.br`) com equipe, 40 clientes, agenda de 4 semanas atrás a 2 semanas à frente, fidelidade,
banners, loja e vouchers. Não chama nenhum serviço externo (os pagamentos entram pelo mesmo caminho do webhook, sem consultar o
Mercado Pago, e a loja só tem retirada) e funciona com `INTEGRATIONS_MODE=real`. A senha do dono é gerada na hora e aparece
**uma única vez** no terminal, junto do link de entrada. Rodar de novo não duplica nada, completa o que faltar, atualiza a agenda até 2 semanas à frente (rode de novo para atualizar a agenda) e nunca troca a senha
(para trocá-la, use a redefinição de senha do painel). O gerente e os profissionais têm e-mails `@demo.agendaflui.com.br`
com senhas que ninguém conhece, e os avisos para a equipe ficam desligados.

## Backup e restauração

- Banco: `pg_dump --format=custom "$DATABASE_URL" > agendaflui.dump` (use a URL direta se houver pooler).
- Arquivos: copie `/data/storage` (`tar czf storage.tgz -C /data storage`).
- Restaurar: banco vazio, `pg_restore --no-owner -d "$DATABASE_URL" agendaflui.dump`, e `tar xzf storage.tgz -C /data`.

## Atualização

Novo deploy: a partida aplica as migrações novas antes de servir.

## Não faça

- Rodar o seed de demonstração (recusa em produção sem `SEED_ALLOW_PRODUCTION=1`; não use).
- Subir mais de uma instância sem `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` fixa (base64 de 32 bytes, disponível no build e na execução).

## Coolify

Build por Dockerfile; porta 3000; os três domínios no mesmo recurso (`dev.`, `painel.`, `api.`); armazenamento
persistente em `/data/storage`; variáveis acima; verificação de saúde em `/healthz` (o Coolify roda `curl` dentro do
contêiner; a imagem já o traz). O Coolify injeta as variáveis da aplicação também no build: o Dockerfile já conta
com isso. Ao acrescentar um domínio depois de criada a aplicação, confira em General > Container > Labels se há
uma regra `Host(...)` para ele; se faltar, use "Reset To Defaults" e reimplante (sem isso o proxy responde 503).

## Integrações (Mercado Pago)

- As credenciais de cada conta (token e assinatura secreta do webhook) ficam cifradas no banco e só o admin da plataforma
  as grava (painel dev, aba Integrações da conta). O endereço do webhook é por conta, com uma chave secreta de 256 bits
  na URL: `POST /v1/webhooks/mercadopago/{webhookKey}`.
- Autenticação do aviso: se o cabeçalho `x-signature` vier, ele é verificado com a assinatura secreta da conta e uma
  assinatura inválida dá 401. Se NÃO vier, o aviso é aceito, porque não temos certeza de que o Mercado Pago assina os
  avisos da `notification_url` da preferência: quem autentica é a chave secreta da URL, e o estado do pagamento SEMPRE
  vem da consulta à API do Mercado Pago com o token da conta (o corpo do aviso nunca é lido).
- Prazo mínimo para pagar: 30 minutos (o Pix exige). A preferência vence em `max(prazo do pedido, agora + 30 min)`; um
  pagamento que chegar depois do prazo do pedido segue a regra "pago depois de vencer".
- A varredura do agendador confere os pedidos vencidos com o Mercado Pago por até 60 s por rodada.

### Teste no sandbox antes de abrir a loja

Antes de ligar a Loja para uma conta real, com as credenciais de teste do Mercado Pago e o webhook apontado para o host da API:

1. Faça um pedido e pague com Pix no sandbox.
2. Faça outro pedido e pague com cartão de teste.
3. Em cada um, confira no log que o aviso deu 200 (não 401) e que o pedido ficou pago na hora, sem esperar a varredura.

Se o aviso der 401, a assinatura que o Mercado Pago manda não bate com a conferida pelo código: não abra a loja até resolver.
