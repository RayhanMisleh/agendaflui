# Entrada pelo link, equipe no app, sem vouchers e mais fluidez

Abrange os dois repositórios: `painel/` (Next.js: painel dev, painel do negócio, API v1) e `app/` (Expo: iOS, Android e web em `https://app.agendaflui.com.br`).

## Por quê

O dono testou o sistema publicado e quer que ele funcione como o produto será vendido: cada negócio divulga um link próprio; o cliente que entra por ele vê o app "como se fosse do profissional" e fica sempre preso àquela loja; a equipe de cada loja usa o mesmo app no celular para a agenda do dia; o cadastro da equipe manda convite de verdade por e-mail; vouchers não fazem parte do produto; e o sistema precisa parecer fluido, não "quadrado e travado".

## Decisões do dono (2026-11-23)

1. **Link do cliente.** O dono do negócio copia no painel `https://app.agendaflui.com.br/<slug>` para pôr na bio ou mandar ao cliente. Ao tocar: com o app instalado, abre o app no login/espaço daquela loja; sem o app, abre o mesmo login no navegador. A loja vem da URL. Depois do cadastro, toda entrada do cliente já é naquela loja. A tela de login web tem os botões para baixar o app (App Store e Google Play) e diz que no app ele recebe as notificações.
2. **Visual da loja.** Depois de entrar pelo link, app e web mostram **logo, nome e cor principal da loja**; a Agenda Flui aparece só como "feito com Agenda Flui" discreto. (Substitui a decisão de 18/11 de usar a paleta fixa da Agenda Flui no app.)
3. **Equipe sem link de entrada e sem escolher loja.** Some `/entrar/<slug>` da equipe e some a tela "escolher conta". Entrada única `painel.agendaflui.com.br/entrar` (e-mail e senha). Cada login da equipe pertence a **uma loja só**; o primeiro dono é criado pela plataforma (painel dev) e fica sempre preso àquela loja.
4. **Cadastro de profissional com e-mail obrigatório** e convite pelo Resend no mesmo passo.
5. **App também para a equipe (caminho 1 de 3).** O app ganha a área da equipe para o dia a dia; o painel completo continua no computador para gestão (configurações, relatórios, equipe, produtos, prêmios). Ao abrir o app sem link: "Sou cliente" (link ou código da loja) ou "Sou da equipe" (e-mail e senha, cai direto na loja da pessoa).
6. **"Clientes", não "Tutores".** O termo padrão já é "Clientes"; "Tutor(es)" vem do modelo de pet shop, da demo, do seed e da vitrine — sai de todos.
7. **Vouchers saem do sistema inteiro** (painel, painel dev, API, banco, seed, testes, docs).
8. **Fluidez e responsividade** no painel e no app: animações, transições de página, telas que se ajustam melhor.
9. **Demo com cara de cliente real:** logo de verdade e cores próprias (não as da Agenda Flui).

## Escopo por parte

### A. Link do cliente e loja no app
- Variável `APP_WEB_URL` (padrão `https://app.agendaflui.com.br`) no painel, validada em `env.ts`. Área **"Link para clientes"** no painel do negócio (na página Clientes e no Início): o link, copiar, compartilhar e **QR code** para imprimir no balcão. Só dono e gerente.
- App web: `/<slug>` abre a entrada da loja (já existe a leitura do caminho em `src/business/storeLink.js`). A entrada da loja na web mostra o logo e o nome da loja, os botões das lojas de aplicativos (URLs em variáveis do build; botão some se a URL não existir) e a frase sobre notificações.
- **Abrir o app instalado pelo link https** (links universais / App Links): `app.json` com `associatedDomains` (iOS) e `intentFilters` com `autoVerify` (Android) para `app.agendaflui.com.br`; o export web gera `/.well-known/apple-app-site-association` e `/.well-known/assetlinks.json` a partir de variáveis do build (ID do time Apple e impressão SHA-256 do certificado Android), com `.htaccess` servindo os dois com o tipo certo. Sem essas variáveis, os arquivos não são gerados e o link abre a web — o dono preenche quando tiver as contas de desenvolvedor.
- **Marca da loja no app:** `GET /v1/business` passa a expor logo, nome e cor principal (e o que mais o app precisar, sem segredos). O app deriva da cor principal os tons (forte, claro, texto sobre a cor) com contraste AA garantido, como o painel já faz em `src/ui/theme/derive`; logo e nome no topo e na entrada. A Agenda Flui fica na entrada genérica (sem loja) e no "feito com Agenda Flui".

### B. Equipe: entrada, convite e e-mail
- **Uma loja por login da equipe:** regra no domínio (e índice no banco, se couber) — convidar um e-mail que já é da equipe de outra loja é recusado com mensagem clara. O painel dev, ao criar a conta, cria o primeiro dono. Antes da migração, conferir em produção se há usuário com mais de um vínculo ativo; se houver, parar e perguntar ao dono.
- Somem: rota `/entrar/<slug>` da equipe, `/escolher-conta`, o cookie de marca da última conta (a tela de entrada da equipe passa a ser a da Agenda Flui), e o "link de entrada" do painel dev (coluna na lista de contas e tela final do assistente de nova conta).
- **Cadastrar profissional num passo:** nome, e-mail (obrigatório) e papel (profissional ou gerente) → cria a ficha, o vínculo e envia o convite (já existem `inviteAccess`, `issueInvite`, `render-invite.ts`) numa transação; e-mail enviado depois de gravar (falha de envio não desfaz o cadastro; a ficha mostra "Convite não enviado — reenviar"). Lista da equipe com "Convite enviado", "Ativo", "Desativado"; reenviar, desativar, redefinir senha continuam.
- **E-mail pelo Resend de verdade:** hoje o envio é SMTP (`SMTP_URL`, `MAIL_FROM`), que o dono configurou com o Resend. Conferir em produção que chega (botão "Enviar e-mail de teste para mim" na página Sistema do painel dev, com o resultado do envio na tela e na auditoria). Se o SMTP do Resend não servir, usar a API HTTP do Resend com `RESEND_API_KEY` (o dono cadastra no Coolify). Domínio remetente verificado no Resend é do dono.
- O convite e o e-mail de "definir senha" passam a citar também o app: "Baixe o app Agenda Flui para ver sua agenda no celular".

### C. Área da equipe no app
- Entrada "Sou da equipe": e-mail e senha em `/v1/auth/staff/login` **sem** loja escolhida antes — a API descobre a loja pelo vínculo único do e-mail (mudança na rota de login da equipe; o token já leva a conta). Depois disso, o app fica na loja da pessoa, com a marca dela.
- Telas (reaproveitando os componentes do app): **Agenda** (dia e semana; o profissional vê só a própria, dono e gerente veem todos e filtram por profissional), **detalhe do atendimento** (confirmar, concluir, marcar falta, cancelar, remarcar), **bloquear horário**, **cliente** (nome, contato rápido, histórico com aquela loja respeitando as permissões do painel), **perfil** (sair). Rotas `/v1/staff/*` já existentes; completar o que faltar com o mesmo domínio.
- **Notificação para a equipe:** novo agendamento, cancelamento e remarcação feitos pelo cliente avisam o profissional (e o dono/gerente, se configurado) por push no app. Registrar aparelho da equipe em `/v1/me/devices` (ou rota da equipe equivalente).
- Gestão (configurações, relatórios, equipe, produtos, prêmios, loja) **não** entra no app: um botão "Abrir painel completo" leva a `painel.agendaflui.com.br`.

### D. Remover vouchers
Remoção completa: tabelas e colunas por migração nova com `DROP` (nunca editar migração antiga), módulo e capacidade `manage_vouchers`, rotas da API e OpenAPI, painel do negócio, painel dev (aba Módulos, assistente), pedidos sem item de voucher, seed, demo, smoke, testes e docs. O inventário está no levantamento de 2026-11-23 (cerca de 25 arquivos de teste).

### E. Termos
"Clientes" em todos os padrões: modelo de pet shop do assistente de nova conta, seed, demo, vitrine e comentários. Os termos continuam editáveis por conta.

### F. Fluidez e responsividade
- **Painel:** transições entre páginas com View Transitions (no Next 16 funcionam sem configuração — ver `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`); telas de carregamento com esqueleto (`loading.tsx`) nas páginas com dados; resposta ao toque em botões, linhas e cartões; folhas e diálogos com entrada e saída; listas que entram uma vez ao carregar (não a cada clique). Revisão de responsividade de todas as telas do painel do negócio e do dev a 375, 768 e 1280 px: nada de largura fixa, tabelas que viram cartões, grades que quebram, formulários em uma coluna no celular. Tudo respeita `prefers-reduced-motion`. Desempenho: nada de animação que trave a rolagem (só `transform` e `opacity`).
- **App:** transições de tela ligadas também no Android (hoje desligadas em `Navigator.js`), esqueletos de carregamento, resposta ao toque, puxar para atualizar onde há lista, animações de entrada das telas de sucesso já existentes; responsividade da versão web (largura máxima centrada no computador). Respeita "reduzir movimento" do sistema.
- Regra da marca continua: movimento só em resposta a ação ou para mostrar o que mudou; nada de animação decorativa espalhada.

### G. Demo com cara de cliente real
O comando `demo:create` passa a criar um pet shop fictício com **nome, logo vetorial de verdade** (símbolo + nome, desenhado em SVG, exportado em PNG para logo, símbolo e favicon) e **paleta própria** (não Água/Caramelo), aplicada pela personalização da conta; sem vouchers; termos "Clientes"; continua idempotente e imprimindo a senha só no terminal de quem roda.

## Não-metas
- Gestão completa no app (relatórios, configurações, produtos, equipe).
- Dono com várias lojas no mesmo login.
- Publicar o app nas lojas (é do dono; a sessão de builds já prepara).
- Testes de navegador e conferência visual pelos agentes (o dono testa).

## Anti-metas
- Cliente de uma loja ver outra loja ou dados de outra loja; profissional ver agenda ou clientes de colega quando o papel não permite.
- Convite que não chega e ninguém percebe.
- Animação que deixa o painel ou o app mais lento, ou que ignora "reduzir movimento".
- Sobrar "Tutor", "voucher" ou o link de entrada da equipe em qualquer tela.

## Ordem de construção
1. D (vouchers) e E (termos) — limpeza que reduz o resto.
2. B (equipe, convite, e-mail).
3. A (link do cliente, marca da loja, links universais) — painel e app.
4. C (área da equipe no app).
5. G (demo).
6. F (fluidez e responsividade) por último, porque toca todas as telas.

Execução por agentes Sonnet; revisão Opus nas partes de acesso e sessão (B, C e a mudança no login da equipe da API) e na remoção de vouchers (migração com `DROP`). Antes de reimplantar no servidor, pedir o sim do dono.

## Decisões de quem escreveu (para o dono conferir)
- **Uma loja por login conta só vínculos ativos.** Quem foi desativado na loja A pode ser convidado na B; aí reativar na A é recusado enquanto estiver ativo na B. O login da equipe sem loja usa o único vínculo ativo. Índice único parcial (só ativos) por usuário. Admins da plataforma são outra tabela e ficam fora da regra.
- **Conferência em produção antes de publicar:** a migração do índice único falha com mensagem clara se houver usuário com dois vínculos ativos; antes do deploy, o coordenador consulta o banco de produção (somente leitura) e, se houver caso, pergunta ao dono.
- **Cliente:** continua sendo um cadastro por loja (o mesmo e-mail pode existir em duas lojas como cadastros independentes). O app guarda uma loja por vez; "Sou cliente" sem link pede o código da loja, que é o próprio identificador da loja (o mesmo do link).
- **Marca antes do login:** `GET /v1/business` já responde com a loja do cabeçalho `X-Business`, sem login; passa a incluir logo, nome e cor principal.
- **Avisos para a equipe:** o profissional recebe os do próprio atendimento; dono e gerente recebem os dos atendimentos deles e, se ligarem no perfil do app "Receber avisos de toda a loja" (preferência nova por vínculo, desligada por padrão), os de todos.
- **Push:** o servidor envia e o app registra o aparelho; as credenciais de push (APNs e FCM pelo EAS) são do dono e ficam fora do escopo — sem elas, o aviso não chega, mas nada quebra.

## O que fica para o executor
Formato do QR code; textos das telas na voz da marca; quais telas do painel ganham esqueleto; a curva e a duração das animações (curtas, 150–250 ms); como o app guarda a marca da loja para abrir rápido.
