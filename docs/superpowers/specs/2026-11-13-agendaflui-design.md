# AgendaFlui — Documento de Design

> Documento de trabalho. Ele e o plano de implementação são apagados no fechamento do
> projeto; o que fica no repositório é só a documentação enxuta descrita na seção 14.

## 1. O que é e por quê

AgendaFlui é um sistema de agendamento para empresas de serviço (pet shops, barbearias,
clínicas, estúdios etc.), vendido como produto para vários negócios ao mesmo tempo. Cada
negócio ("conta") tem sua própria marca dentro do sistema: quando o dono entra, o painel tem
a cara da empresa dele.

O projeto parte das funcionalidades de um sistema anterior de barbearia que está nesta pasta
como referência (`api-legacy/`, `src/admin-legacy/`). **Nada daquele código, banco ou marca é
reaproveitado.** Ele serve só para saber quais funções existem. O sistema antigo sofria com
bugs de fuso horário, agendamentos em horário errado e lógica duplicada; o novo é reescrito
do zero para que essa classe de problema não possa acontecer.

Esta pasta é uma **cópia** do sistema antigo, sem git e sem ligação com a produção dele
(não há `.env` nem configuração de deploy aqui). Pode ser reestruturada à vontade.

Três peças:

| Peça | Endereço | Quem usa |
|---|---|---|
| Painel dev | `dev.agendaflui.com.br` | Nós, donos da plataforma (admins master) |
| Painel do negócio | `painel.agendaflui.com.br` | Donos de negócio e suas equipes |
| API do app | `api.agendaflui.com.br` | O aplicativo (web, iOS, Android), que será reformado depois em outro repositório |

Este repositório contém os dois painéis **e** é o back-end do app.

## 2. Metas, não-metas e anti-metas

**Metas**

- Várias contas isoladas num banco só; nenhum dado de uma conta aparece em outra.
- Painel dev completo: criar e personalizar contas ao máximo (marca, módulos, termos,
  regras), gerenciar chaves, ver métricas da plataforma, de cada conta e da API.
- Painel do negócio com todas as funções do painel antigo, generalizadas, em visual
  skeuomórfico (materiais e objetos do mundo real), fácil de usar no computador e no celular.
- Agenda e fuso horário corretos por construção, com testes.
- API versionada e documentada, pronta para o app reformado consumir.
- Roda inteiro na máquina local com um comando.

**Não-metas (ficam fora desta entrega)**

- Reformar o aplicativo (outro repositório, depois).
- Publicar em produção (VPS, domínio, HTTPS). O código fica pronto para isso; a configuração
  de servidor não é feita agora.
- Cobrança de assinatura das contas (planos, boletos, cartão). A conta tem só situação
  (ativa, suspensa, arquivada) e observações.
- Migrar dados do sistema antigo.
- Mais de uma unidade por conta. Uma conta = um endereço = um fuso. Uma rede com 3 lojas são
  3 contas (o mesmo dono pode ter acesso às 3 com um login só).
- Outros idiomas além de pt-BR e outra moeda além de BRL.
- Modo escuro no painel do negócio.
- Notificações por WhatsApp/SMS.

**Anti-metas (seria fracasso mesmo funcionando)**

- Conta A conseguir ler ou alterar qualquer dado da conta B.
- Conta de horário espalhada pelo código, ou qualquer cálculo que dependa do fuso do
  servidor ou do navegador.
- Texturas e relevos que atrapalhem a leitura, deixem o painel lento ou quebrem no celular.
- Sobrar no produto qualquer termo fixo do sistema antigo ("barbeiro", "Sans", "Sans Coins").
- Documentação inchada: histórico de mudanças, relatos de incidentes, registros de sessão.

## 3. Restrições

- Tudo local por enquanto. A máquina não tem Postgres, Docker nem Homebrew: o banco de
  desenvolvimento é um Postgres embutido que sobe junto com `npm run dev`.
- Produção futura em VPS (processo Node único e de longa duração), não em serverless. Isso
  permite agendador interno e armazenamento em disco.
- Next.js 16 (já é o do projeto). Ele tem mudanças em relação a versões anteriores: quem
  implementar deve ler `node_modules/next/dist/docs/` antes de escrever código.
- O app futuro precisa conseguir funcionar só com a API pública `v1`.

## 4. Abordagens consideradas

| | Abordagem | Prós | Contras |
|---|---|---|---|
| **A** | **Reescrever do zero num projeto Next.js único (TypeScript), servindo os dois painéis e a API por endereço** | Uma base para manter e publicar; sem herança de gambiarra; regras de negócio num lugar só, usadas por painéis e API | Mais trabalho inicial |
| B | Adaptar o código atual (Express embrulhado no Next + SPA) | Começa mais rápido | Carrega os problemas que motivaram a reforma; telas de 2.000 linhas; sem tipos |
| C | Três projetos (API, painel dev, painel do negócio) | Separação mais rígida | Três publicações e configurações; nenhum ganho real neste tamanho |

**Escolhida: A**, aprovada pelo dono do projeto.

## 5. Arquitetura

### 5.1 Tecnologias

- Next.js 16 (App Router), React 19, TypeScript estrito.
- PostgreSQL + Prisma (versão estável mais recente). Migrações SQL versionadas.
- Tailwind CSS 4 para layout; o visual skeuomórfico vive num design system próprio em
  `src/ui/` (seção 11).
- Zod para validar toda entrada (API, formulários, variáveis de ambiente).
- Temporal (polyfill) como única biblioteca de data/hora no servidor.
- Vitest (unidade e integração com Postgres real) e Playwright (poucos testes de ponta a
  ponta dos fluxos principais).

### 5.2 Um projeto, três endereços

`src/proxy.ts` (o "middleware" do Next 16) lê o host da requisição e encaminha:

| Host (produção / local) | Vai para |
|---|---|
| `dev.agendaflui.com.br` / `dev.localhost:3000` | grupo de rotas do painel dev |
| `painel.agendaflui.com.br` / `painel.localhost:3000` | grupo de rotas do painel do negócio |
| `api.agendaflui.com.br` / `api.localhost:3000` | `/v1/*` (API do app) |

Rotas de um endereço não respondem em outro (o painel dev não existe em `painel.`). Os hosts
vêm de variáveis de ambiente, sem domínio fixo no código.

### 5.3 Camadas

```
src/
  app/                 só telas, rotas e ações: validam, autorizam, chamam o domínio
    (dev)/…            painel dev
    (painel)/…         painel do negócio
    api/v1/…           API do app
  proxy.ts
  server/
    domain/<módulo>/   regras de negócio (serviços), esquemas Zod, políticas de acesso
    db/                cliente Prisma e o cliente "por conta" (5.4)
    time/              ÚNICO lugar com conversão de fuso (seção 7)
    auth/              sessões, senhas, tokens, chaves
    notifications/     fila de envio, modelos de e-mail e push
    storage/           arquivos (disco local; S3 compatível opcional)
    integrations/      Mercado Pago, Frenet, Expo Push, SMTP
    metrics/           coleta e agregação de uso
  ui/                  design system (tema, componentes)
prisma/                schema, migrações, seed
tests/
```

Regra: painéis e API **nunca** falam com o banco direto. Os painéis chamam o domínio por
Server Components e Server Actions; a API chama o mesmo domínio por rotas HTTP. Uma regra
existe uma vez só.

Módulos de domínio: `platform` (contas, admins, auditoria), `identity` (usuários, acessos),
`customers`, `catalog` (serviços), `team` (profissionais, expediente), `scheduling`
(disponibilidade, agendamentos), `reports`, `loyalty`, `banners`, `store` (produtos, pedidos,
pagamentos, frete), `vouchers` (parceiros e vouchers), `settings`.

### 5.4 Isolamento entre contas

- Toda tabela de dados de negócio tem `business_id` obrigatório, com índice.
- O domínio recebe sempre um contexto `{ businessId, actor }` e usa `tenantDb(businessId)`:
  um cliente Prisma estendido que injeta `business_id` em toda leitura, escrita, alteração e
  exclusão. O cliente Prisma "cru" só é importável dentro de `server/db/` e do módulo
  `platform` (regra de lint).
- Dentro de `tenantDb` cada modelo tem uma de quatro classes: **da conta** (filtrado por
  `business_id`), **da conta com dono opcional** (arquivos e auditoria; sempre filtrado pela
  conta quando acessado por aqui), **a própria conta** (`businesses`, só leitura e alteração
  do próprio registro) e **da plataforma** (admins, usuários, sessões: bloqueados). Consultas
  que entram num modelo da plataforma por relação e escritas aninhadas são recusadas; SQL
  cru também. Modelo novo sem classe falha fechado.
- Chaves estrangeiras compostas com `business_id` nas relações principais, para o próprio
  banco recusar ligar um agendamento da conta A a um cliente da conta B.
- Teste automático que percorre todos os modelos do schema e falha se algum modelo de
  negócio não estiver coberto pelo `tenantDb`; testes de integração que tentam ler e alterar
  dados de outra conta em cada módulo.
- Row Level Security do Postgres fica como endurecimento futuro, não nesta entrega.

## 6. Modelo de dados

Convenções: tabelas e colunas em inglês, `snake_case`; chave primária UUID gerada pelo
banco; dinheiro em **centavos inteiros** (`*_cents`), nunca decimal flutuante; todo instante
em `timestamptz`; horário de expediente em minutos desde a meia-noite local (inteiro, sem fuso); toda tabela com
`created_at`/`updated_at`. Exclusão de registros com histórico (cliente, profissional,
serviço) é arquivamento (`archived_at`), não remoção. Quando o próprio cliente pede a
exclusão da conta pelo app (LGPD), o cadastro é **anonimizado**: nome, e-mail, telefone,
foto, endereços, senha, tokens e dispositivos são apagados, e os agendamentos, pedidos e
pontos permanecem ligados a um cliente sem identificação, para os relatórios não mudarem.

**Plataforma**

- `platform_admins`, `platform_sessions`
- `audit_logs` — quem fez o quê, em qual conta, quando (ações do painel dev e ações
  sensíveis do painel do negócio)
- `businesses` — nome, `slug`, segmento, documento, contato, endereço, `timezone` (IANA),
  situação (`ACTIVE`, `SUSPENDED`, `ARCHIVED`), observações internas
- `business_branding` — ver seção 10
- `business_modules` — quais módulos opcionais estão ligados
- `business_settings` — regras de agenda, termos, notificações (seção 8.2)
- `business_integrations` — credenciais de Mercado Pago, Frenet e SMTP próprio, cifradas
- `api_keys` — chaves do app por conta (seção 9.2)
- `api_usage_hourly` — uso agregado por chave, rota e hora

**Pessoas**

- `users` — identidade de quem entra no painel (e-mail único, senha)
- `memberships` — liga usuário a conta com um papel (`OWNER`, `MANAGER`, `PROFESSIONAL`)
- `sessions` — sessões dos painéis
- `customers` — clientes finais, **por conta** (o mesmo e-mail pode existir em duas contas
  como clientes diferentes); podem não ter senha (cadastrados no balcão)
- `customer_refresh_tokens`, `devices` (tokens de push), `verification_codes` (confirmação
  de e-mail, troca de senha, exclusão de conta)

**Agenda**

- `professionals` — quem atende; liga opcionalmente a um `membership`; nome, foto, bio,
  comissão, ativo, ordem de exibição
- `services` — nome, ícone, preço, duração, pontos de fidelidade, só-para-clube, ativo
- `professional_services` — quais serviços cada profissional faz
- `working_hours` — profissional, dia da semana, início e fim (vários intervalos por dia,
  o que cobre pausa de almoço)
- `time_blocks` — bloqueios de um profissional (folga, compromisso) com início e fim
- `business_closures` — dias em que o negócio inteiro fecha (feriado, recesso)
- `appointments` — cliente, profissional, `starts_at`, `ends_at`, situação (`PENDING`,
  `CONFIRMED`, `COMPLETED`, `CANCELED`, `NO_SHOW`), total, comissão gravada na conclusão,
  observações, origem (`APP`, `PANEL`), quem criou, quem e por que cancelou
- `appointment_items` — serviços do agendamento com nome, preço e duração **copiados** no
  momento da marcação (mudar o preço de um serviço não altera agendamentos já feitos)

**Avisos**

- `notifications` — fila de envio (tipo, canal, destinatário, quando enviar, situação,
  tentativas). Lembretes de 24h e de 1h são linhas agendadas nesta fila, criadas junto com
  o agendamento e canceladas ou refeitas quando ele muda.

**Módulos opcionais**

- Fidelidade: `loyalty_transactions` (extrato de pontos; o saldo é a soma), `prizes`,
  `prize_redemptions`; `customers.is_club_member`
- Banners: `banners`
- Loja: `product_categories`, `products`, `product_images`, `addresses`, `orders`,
  `order_items`, `payments`
- Vouchers: `partners`, `vouchers`, `voucher_codes`

**Arquivos**: `uploads` (dono, caminho, tipo, tamanho).

## 7. Tempo e fuso horário

Regras, sem exceção:

1. O banco guarda **instantes** (`timestamptz`). Nunca "os dígitos da hora local".
2. Cada conta tem seu fuso (`businesses.timezone`). Expediente é hora local da conta.
3. Toda conversão entre instante e hora local passa por `server/time/`, com Temporal. Fora
   dessa pasta é proibido por lint usar `new Date(texto)`, `getHours`, `getDay`,
   `toLocale*` e parecidos. O fuso do processo e o do navegador nunca entram em conta.
4. Quem consome (painel ou app) **não faz conta de fuso**. O servidor devolve cada horário
   livre como instante exato mais o rótulo local pronto para exibir; para marcar, o cliente
   devolve o mesmo instante que recebeu.
5. Os painéis mostram sempre a hora da conta, mesmo que o navegador esteja em outro fuso.
6. "Dia" em relatório, agenda e métricas é o dia de calendário no fuso da conta.

`server/time/` expõe poucas funções puras: intervalo de um dia local em instantes, dia da
semana de uma data, combinar data + hora local em instante (tratando horas que não existem
ou se repetem em mudança de horário de verão), formatar instante no fuso da conta.

Testes obrigatórios: São Paulo, Manaus, Lisboa e Nova York (com horário de verão),
viradas de dia, de mês e de ano, e execução da suíte com o processo em fusos diferentes
(`TZ=UTC`, `TZ=Asia/Tokyo`) dando o mesmo resultado.

## 8. Agenda

### 8.1 Horários livres (uma implementação só, em `scheduling`)

Entrada: conta, data local, serviços escolhidos, profissional (ou "qualquer um").
Duração = soma das durações dos serviços. Para cada profissional que faz todos os serviços:

1. pega os intervalos de expediente daquele dia da semana e converte para instantes;
2. remove fechamentos do negócio, bloqueios e agendamentos ativos (`PENDING`, `CONFIRMED`,
   `COMPLETED`), considerando o intervalo entre atendimentos, se configurado;
3. gera inícios possíveis na grade da conta em que a duração inteira cabe;
4. descarta o que viola antecedência mínima e janela máxima de marcação.

Funções puras sobre dados já carregados, testáveis sem banco.

### 8.2 Regras configuráveis por conta

Grade de horários (padrão 15 min), antecedência mínima para marcar (padrão 1 h), até quantos
dias à frente (padrão 60), prazo para o cliente cancelar ou remarcar pelo app (padrão 2 h),
intervalo entre atendimentos (padrão 0), se o agendamento já nasce confirmado (padrão sim).
A equipe, pelo painel, pode marcar fora da grade e da antecedência; nunca em sobreposição.

### 8.3 Marcar, remarcar, cancelar

- Marcar e remarcar rodam numa transação que trava o profissional
  (`pg_advisory_xact_lock`), revalida a disponibilidade e grava. Devolve erro claro
  ("esse horário acabou de ser ocupado") com os horários livres mais próximos.
- Rede de segurança no banco: restrição de exclusão que impede dois agendamentos ativos
  sobrepostos para o mesmo profissional (`EXCLUDE USING gist` com `btree_gist`). Mesmo que
  um erro de código passe, o banco recusa. *Verificar na fundação se o Postgres embutido
  traz `btree_gist`; se não trouxer, a restrição vai só na migração de produção e o teste
  de concorrência cobre a trava da transação.*
- Situações seguem uma máquina de estados explícita; transição inválida é erro.
  `PENDING → CONFIRMED → COMPLETED`; `PENDING/CONFIRMED → CANCELED`; `CONFIRMED → NO_SHOW`;
  e a equipe pode desfazer um engano (`COMPLETED/NO_SHOW → CONFIRMED`).
  Concluir grava a comissão calculada naquele momento e credita pontos (uma vez só).
- Teste de concorrência: 20 tentativas simultâneas no mesmo horário, exatamente 1 passa.

### 8.4 Avisos

Eventos: confirmação, cancelamento, remarcação, lembretes, agradecimento após conclusão,
"seu profissional já está livre", e os avisos para a equipe (novo, cancelado, remarcado).
Cada um pode ser ligado ou desligado por conta e por canal (e-mail, push). O cliente tem
suas preferências próprias. Um agendador interno processa a fila a cada minuto, reservando
linhas com `FOR UPDATE SKIP LOCKED` (seguro mesmo com mais de um processo) e com nova
tentativa em caso de falha. E-mails saem com o nome, a logo e as cores da conta. Em
desenvolvimento, e-mails são gravados em `.local/mail/` em vez de enviados.

## 9. Acesso

### 9.1 Painéis

- **Painel dev**: `platform_admins`, sessão própria, cookie restrito ao host `dev.`.
  O primeiro admin nasce do seed ou de `npm run admin:create`.
- **Painel do negócio**: `users` + `memberships`. Quem tem acesso a mais de uma conta
  escolhe em qual entrar e pode trocar sem sair.
- Sessões guardadas no banco (token opaco, só o hash é gravado), cookie `httpOnly`,
  revogáveis. Senhas com argon2id. Limite de tentativas de login.
- **Entrar como**: um admin da plataforma pode abrir o painel de uma conta para dar suporte,
  com os mesmos poderes do dono. Não é um `membership` falso: a sessão guarda um ator do
  tipo "admin da plataforma atuando na conta X", e toda alteração feita assim vai para a
  auditoria com o nome do admin. Aparece uma faixa permanente avisando. Segredos de
  integração nunca são exibidos de volta para ninguém (só os últimos 4 caracteres); quem
  quiser mudar digita um novo.

Papéis dentro da conta (generalização dos 3 perfis antigos):

| Papel | Pode |
|---|---|
| Dono (`OWNER`) | Tudo, incluindo dados da conta e integrações |
| Gerente (`MANAGER`) | Tudo da operação: agenda de todos, equipe, clientes, catálogo, relatórios, configurações |
| Profissional (`PROFESSIONAL`) | Própria agenda, próprios horários e bloqueios, próprios relatórios, clientes (leitura), próprio perfil |

Atender clientes é independente do papel: dono ou gerente também podem ter ficha de
profissional e aparecer na agenda. As permissões são uma lista única de capacidades em
`identity`, usada pelo servidor (que é quem bloqueia) e pelas telas (que só escondem).

### 9.2 API do app e chaves

- Toda requisição do app traz uma **chave de app** no cabeçalho `X-App-Key`. Há dois tipos,
  para a API servir tanto um app único quanto apps com marca própria:
  - **chave de conta**: presa a uma conta; a API já sabe de quem se trata. Serve para um app
    publicado só para aquele negócio.
  - **chave de plataforma**: de um app compartilhado; a conta vem no cabeçalho
    `X-Business` (o `slug`). Com ela existe também `GET /v1/businesses/{slug}` para o app
    abrir um negócio a partir de um link ou código.
  Uma chave tem nome, origens web permitidas (CORS), situação (ativa, revogada) e data do
  último uso. Só o hash é guardado; o valor completo aparece uma vez, na criação.
- Cliente e equipe entram por rotas separadas (`auth/customer/*` e `auth/staff/*`) e
  recebem tokens de tipos diferentes; o token diz o tipo, a conta e, para equipe, o papel.
  Token de cliente não acessa rotas `staff/*` e vice-versa. O mesmo e-mail pode ser equipe
  e cliente da mesma conta: são cadastros independentes.
- Token de acesso curto (JWT, 15 min) e token de renovação rotativo (guardado como hash,
  revogável). O cadastro do cliente vale só para aquela conta.
- Envio de push usa credenciais da plataforma (um projeto Expo), não por conta.
- Limite de requisições por chave e por IP.

### 9.3 Contrato da API `v1`

REST em JSON. Erros sempre no formato `{ "error": { "code", "message", "fields" } }`.
Especificação OpenAPI gerada a partir dos esquemas Zod e visível no painel dev (é a
documentação para quem for reformar o app). Grupos de rotas:

- `business` — nome, marca, módulos ligados e termos da conta (o app se veste com isso)
- `auth` — cadastro, confirmação de e-mail, entrar, renovar, sair, trocar senha, excluir conta
- `me` — perfil, preferências de aviso, dispositivos de push
- `services`, `professionals`, `availability`
- `appointments` — marcar, listar, próximo, cancelar, remarcar
- `staff/*` — agenda do profissional, mudar situação, bloqueios, expediente
- módulos: `loyalty/*`, `banners`, `store/*` (produtos, endereços, frete, pedidos,
  pagamento), `vouchers/*`
- `webhooks/mercadopago/{conta}`

Rota de módulo desligado responde `404` com código `module_disabled`. As rotas antigas
(`api.sejasans.com.br`) não são mantidas; o app será reformado contra a `v1`.

## 10. Personalização por conta

Tudo abaixo é editado no painel dev, na criação da conta ou depois, com **prévia ao vivo**
do painel do negócio ao lado do formulário.

- **Marca**: nome de exibição, logo, símbolo (quadrado), favicon, cor principal, cor de
  destaque, material da capa (couro, linho, madeira, esmalte), tom do papel (branco, creme,
  cinza), par de fontes (entre opções curadas), imagem e mensagem da tela de entrada.
  As cores derivadas (sombras, realces, texto sobre a cor) são calculadas; se a cor escolhida
  não der contraste suficiente, o sistema ajusta o texto e avisa no formulário.
- **Termos**: como a conta chama o profissional ("Barbeiro", "Tosador", "Terapeuta"), o
  cliente ("Cliente", "Tutor", "Paciente"), os pontos ("Pontos", "Patinhas") e o clube.
  Singular e plural. Usados em telas, e-mails e na API.
- **Módulos**: Fidelidade, Banners, Loja, Vouchers ligados ou desligados. Módulo desligado
  some do menu, das rotas do painel e da API. Vouchers são vendidos dentro de um pedido e
  pagos como qualquer produto, então **Vouchers exige Loja**: o painel dev não deixa ligar
  um sem o outro.
- **Regras de agenda** (8.2), **fuso**, **avisos** (8.4).
- **Conta**: dados cadastrais, dono (cria o usuário e envia convite para definir senha),
  situação, observações internas, chaves de app.

O dono, no painel do negócio, pode ajustar regras de agenda, avisos, termos, integrações e
trocar logo. Cores, material, fontes e módulos são só do painel dev.

**Tela de entrada com a marca**: o endereço é um só para todos, então antes do login o
sistema não sabe de quem é a conta. Solução: cada conta tem um link de entrada próprio,
`painel.agendaflui.com.br/entrar/{slug}`, já com a marca dela (o painel dev mostra esse link
para copiar). Depois do primeiro acesso, o navegador lembra a conta e a entrada genérica
`/entrar` também aparece com a marca. Sem essa memória, `/entrar` usa a marca AgendaFlui.

## 11. Direção visual

> Substituída em 2026-11-17 por `2026-11-17-redesenho-marca-design.md` (marca Agenda Flui, pasta `../branding/`).
> O texto abaixo descreve a direção anterior, de papelaria, e não vale mais.

Skeuomórfico: superfícies que imitam materiais reais, com luz, relevo e peso. O risco do
estilo é virar enfeite; aqui cada objeto imita algo que **já tem aquela função** num balcão
de atendimento.

**Painel do negócio — "a agenda de balcão"**

- O painel é uma agenda de mesa encadernada. A **capa** (barra lateral e topo) usa o
  material e a cor principal da conta, com a logo em baixo-relevo. O **conteúdo** é sempre
  papel: é ali que se lê, então nunca recebe a cor da marca como fundo.
- Menu = **divisórias de fichário** saindo da lateral; a ativa encosta no papel.
- Agenda do dia = **página de planner** com as horas na margem e cada agendamento como uma
  **ficha de papel** presa na linha do horário, com altura proporcional à duração. A
  situação é um **carimbo** ("Confirmado", "Concluído", "Faltou"). É a tela onde o estilo
  aparece com mais força; as demais são mais contidas.
- Botões = teclas com curso (afundam ao clicar). Interruptores = chave física liga/desliga.
  Campos = rebaixados no papel. Números do dashboard = **contadores mecânicos**.
- Folhas e gavetas: no celular, formulários sobem como folha da base da tela.
- Texturas feitas em CSS e SVG leve (ruído, fibra, costura), sem fotos pesadas. Luz sempre
  de cima à esquerda. Movimento só em resposta a ação; respeita "reduzir movimento".

**Painel dev — "a mesa de controle"**

Mesmo conjunto de componentes, outro material: painel de instrumentos em metal anodizado
grafite-azulado, medidores analógicos para saúde do sistema, lâmpadas-piloto para situação
(verde ativa, âmbar suspensa), rótulos gravados. Gráficos de métrica são limpos e legíveis
sobre "vidro" fosco; o relevo fica na moldura, não nos dados.

**Marca AgendaFlui** (usada no painel dev, na entrada genérica e como padrão de conta nova):
azul-petróleo profundo com destaque em âmbar. Proposta inicial, a validar na vitrine.

**Tipografia** (auto-hospedada): texto de interface em Hanken Grotesk; títulos e numerais em
Zilla Slab (cara de papelaria e livro-caixa); carimbos em Barlow Condensed. Proposta
inicial; a conta escolhe entre pares curados.

**Piso de qualidade**: tudo funciona a 375 px; tabelas viram cartões no celular; contraste
AA com qualquer cor de marca; foco de teclado visível; campos com 16 px no celular.

**Vitrine de componentes**: a fundação entrega uma página (`dev.localhost:3000/vitrine`)
com todos os componentes, nos materiais e com troca de marca ao vivo. O dono do projeto
aprova o visual ali antes de as telas serem produzidas em série.

## 12. Telas

### 12.1 Painel dev

- **Visão geral**: contas ativas e novas, agendamentos (hoje, mês, tendência), clientes
  cadastrados, volume financeiro movimentado, usuários ativos do app (dia e mês), uso e
  erros da API, fila de avisos, contas sem atividade recente.
- **Contas**: lista com busca e filtros; **criar conta** em etapas (dados, marca com prévia,
  termos, módulos, regras, dono, chave de app); página da conta com abas (resumo e métricas,
  marca, termos, módulos, regras, equipe, chaves, integrações, auditoria); suspender,
  reativar, arquivar; **entrar como**.
- **Chaves e API**: todas as chaves, uso por chave (requisições, erros, tempo de resposta,
  rotas mais chamadas), criar, revogar; documentação OpenAPI.
- **Sistema**: fila e falhas de avisos, tamanho do banco, execuções do agendador, erros
  recentes.
- **Auditoria**: quem fez o quê.
- **Admins**: gerenciar admins da plataforma; perfil e senha.

### 12.2 Painel do negócio

Tudo que o painel antigo tinha, generalizado:

- **Início**: o dia de hoje (próximos atendimentos, ocupação), números do período; o
  profissional vê só os seus.
- **Agenda**: dia e semana, por profissional ou todos lado a lado; marcar, remarcar
  (arrastar a ficha no computador), mudar situação, adicionar serviços, observações;
  bloqueios; avisar "já estou livre".
- **Clientes**: lista, busca, filtros, ficha com histórico, pontos e clube, contato rápido
  (ligar, e-mail, WhatsApp), criar, editar, redefinir senha, arquivar.
- **Equipe**: profissionais e acessos, papel, foto, comissão, serviços que faz, expediente,
  redefinir senha, remover.
- **Serviços**: nome, ícone, preço, duração, pontos, só-para-clube, ativo.
- **Relatórios**: faturamento, atendimentos, ticket médio, comissão por profissional e por
  serviço, detalhado, com exportação CSV.
- **Fidelidade** (módulo): prêmios, resgates, ajuste de pontos, clube. O ranking de pontos
  entre clientes (existia no app antigo) é uma opção da conta, **desligada por padrão**, e
  mostra só primeiro nome e foto.
- **Banners** (módulo).
- **Loja** (módulo): produtos, categorias, imagens, pedidos, situação de entrega, pagamentos.
- **Vouchers** (módulo): parceiros, vouchers, códigos.
- **Configurações**: negócio, regras de agenda, fechamentos, avisos, termos, logo,
  integrações (Mercado Pago, Frenet, e-mail), meu perfil e senha.

## 13. Qualidade e ambiente local

- `npm run dev`: sobe o Postgres embutido (dados em `.local/pg/`), aplica migrações, roda o
  seed se o banco estiver vazio e inicia o Next. Seed: um admin da plataforma e duas contas
  de demonstração com marcas bem diferentes (um pet shop e uma barbearia), com equipe,
  serviços, clientes e agendamentos. Credenciais de demonstração ficam em `.env.example`.
- Variáveis de ambiente validadas na partida; falta de uma obrigatória é erro claro.
- Integrações externas (Mercado Pago, Frenet, Expo Push, SMTP) atrás de interfaces, com
  implementação falsa para desenvolvimento e testes.
- Uploads: imagens validadas e reprocessadas (tamanho, formato) antes de gravar.
- Segredos de integração cifrados no banco com chave do ambiente.
- Cada fase só fecha com `typecheck`, `lint`, testes e `build` passando.

## 14. Documentação que fica no repositório

Só o necessário para alguém (ou uma IA) trabalhar no projeto:

- `README.md` — o que é, como rodar, comandos
- `AGENTS.md` — regras curtas para quem edita (bloco do Next + regras do projeto)
- `docs/ARQUITETURA.md` — camadas, endereços, isolamento entre contas
- `docs/TEMPO.md` — as regras da seção 7
- A referência da API é a especificação OpenAPI gerada, não um arquivo escrito à mão.

Sem histórico de mudanças, relatos de incidente ou registros de sessão. Os documentos
antigos em `docs/` são removidos junto com o código antigo.

## 15. Ordem de construção

Cada fase tem seu próprio plano de implementação e termina funcionando e testada.

1. **Fundação** — projeto novo, tabelas de base (plataforma, contas, marca, pessoas),
   isolamento entre contas, módulo de tempo, acesso, roteamento por endereço, arquivos,
   seed, design system e vitrine. As tabelas de cada área nascem na fase que as usa, cada
   uma em sua migração.
   *Parada para aprovação do visual.*
2. **Núcleo de agenda**, em duas partes: **2A** domínio (serviços, equipe, expediente,
   bloqueios, fechamentos, clientes, horários livres, agendamentos e fila de avisos) e **2B**
   API `v1` (chaves, login de cliente e de equipe, rotas, documentação OpenAPI) e envio dos
   avisos.
3. **Painel dev** — contas, personalização com prévia, chaves, entrar como, métricas,
   auditoria.
4. **Painel do negócio** — entrada com marca, início, agenda, clientes, equipe, serviços,
   relatórios, configurações.
5. **Módulos** — fidelidade, banners, loja, vouchers (domínio, API e telas).
6. **Fechamento** — apagar código e documentos antigos, escrever a documentação final,
   verificação completa.

O código antigo vai para `_legacy/` no início (fora de build, lint e testes) só como
consulta e é apagado na fase 6.

## 16. Decisões tomadas por quem escreveu (para o dono conferir)

- "Chaves" foi entendido como **chaves de app** (9.2), com métricas de uso. A API aceita
  tanto app único compartilhado quanto app próprio por negócio.
- Cliente que exclui a conta é anonimizado, não apagado; o histórico fica.
- "Entrar como" dá poderes de dono, sempre auditado; segredos nunca são exibidos.
- Vouchers exige Loja. Ranking de pontos é opcional e desligado por padrão.
- "APS" foi entendido como **VPS**; por isso agendador interno e arquivos em disco.
- Sem cobrança de assinatura nesta entrega.
- Clientes finais são por conta, não globais.
- Uma conta = uma unidade.
- Sem modo escuro no painel do negócio.
- Cores, material, fontes e módulos só mudam pelo painel dev; o dono troca logo e ajusta
  regras, termos e avisos.
- Lembretes padrão: 24 h e 1 h antes.
- Repositório git novo, local, sem histórico do sistema antigo, com commits por etapa e
  sem envio para nenhum servidor.

## 17. Deixado para quem implementa

Versões exatas de bibliotecas; desenho fino de cada componente e textura; nomes de arquivos
dentro de cada módulo; forma exata de agregação das métricas de API; biblioteca de gráficos;
paginação e ordenação das listas; textos de interface (seguindo: voz ativa, frase simples,
erro que diz o que houve e como resolver).
