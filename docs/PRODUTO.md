# Produto

O Agenda Flui é um sistema de agendamento web para negócios de serviço. Cada negócio é uma conta (loja) com marca,
equipe, clientes e módulos próprios. Hoje o único nicho é **pet shop**; o código tem a estrutura para outros
(`src/server/niches/`). Não há app nativo nem push: tudo é web e os avisos vão por e-mail.

## Públicos

| Quem | Onde | O que faz |
|---|---|---|
| Admin da plataforma | painel dev (`DEV_HOST`) | cria contas, liga módulos, cadastra integrações e chaves do Google, acompanha o sistema |
| Dono, gerente, profissional | painel do negócio (`APP_HOST/painel`) | agenda, clientes, equipe, serviços, módulos, relatórios, configurações |
| Cliente | área do cliente (`APP_HOST/<slug>`) | agenda, remarca, cancela, cuida dos pets, prêmios e loja |

Termos fixos em todas as contas (`src/shared/terms.ts`): "Profissional/Profissionais", "Cliente/Clientes", "Pontos", "Clube".

## Endereços

- `APP_HOST` (produção: `app.agendaflui.com.br`) serve tudo que não é do admin:
  - `/entrar`, `/esqueci-a-senha`, `/redefinir-senha/<token>`, `/convite/<token>`: entrada geral.
  - `/` decide o destino depois de entrar (`auth/destination.ts`): equipe ativa vai ao painel; senão, a loja em que é
    cliente (a última usada ou a ligação mais recente); sem nenhuma, a tela "sem loja".
  - `/painel/**`: painel do negócio. `/painel/comecar`: começo do dono.
  - `/<slug>/**`: área do cliente da loja (grupos de rota `(acesso)` para entrar e cadastrar, `(area)` para o resto).
  - `/conta`: Minha conta (nome, e-mail, senha, Google, Google Agenda, avisos).
- `DEV_HOST` (produção: `dev.agendaflui.com.br`): painel dev.
- `LEGACY_PAINEL_HOST` (opcional): só redireciona (308) o endereço antigo do painel para o `APP_HOST`.
- Nomes de rota do sistema não podem ser slug de loja (`src/shared/reserved-slugs.ts`, espelhado num CHECK do banco).

O link que a loja passa aos clientes é `https://<APP_HOST>/<slug>` (com QR code).

## Pessoa, contas e acesso

- **Uma pessoa, uma conta** (`users`), com senha e/ou Google. A mesma sessão serve à equipe e às lojas em que a pessoa
  é cliente. Um vínculo ativo de equipe por pessoa (o banco recusa o segundo).
- **Cliente** (`customers`) é por loja. Pode ter conta (`user_id`) ou ser "de balcão" (cadastrado pela equipe, sem
  conta). Ao se cadastrar com o mesmo e-mail, a pessoa adota o cliente de balcão. "Usar minha conta" liga uma pessoa já
  existente a outra loja; abrir a página da loja nunca cria vínculo.
- **Equipe**: papéis `OWNER`, `MANAGER`, `PROFESSIONAL`, mapeados a capacidades em `auth/capabilities.ts`. O profissional
  vê só a própria agenda, os próprios números e o próprio perfil. A conta sempre mantém ao menos um dono ativo.
- **Convite e senha**: convite e redefinição de senha são por link, para todos. "Esqueci a senha" também cria a primeira
  senha de quem só tem Google.
- **Código por e-mail** (6 dígitos): cadastro pela loja e troca de e-mail.
- **Suporte ("entrar como")**: o admin entra no painel de uma conta por 60 minutos, com poderes de dono, menos redefinir
  senha de alguém, agir em Minha conta e ver segredos. Tudo vai para a auditoria.

### Regras do Google (login)

Implementadas na função pura `decideGoogle` (`auth/google/decide.ts`). O vínculo é pelo `sub` do Google, nunca pelo e-mail.
Um Google liga no máximo uma pessoa; uma pessoa tem no máximo um Google.

1. Google vinculado: entra na pessoa dona do vínculo.
2. Google não vinculado cujo e-mail é de conta ativa: recusa ("entre com a senha e vincule em Minha conta").
   2b. Se a conta desse e-mail está pendente (convite): vincula, ativa e consome os convites.
3. Convite: o Google só vale com e-mail igual ao do convite e sem vínculo com outra pessoa.
4. Cadastro pelo link da loja: cria a pessoa já vinculada e o cliente na loja (ou adota o de balcão), e segue ao quiz.
5. Google desconhecido na entrada geral: não cria conta (cliente novo entra pelo link da loja).
6. Vincular em Minha conta: só para quem não tem Google, com e-mail verificado igual ao da pessoa.
7. Desvincular: só com senha criada. Desvincular desliga o Google Agenda.
8. Esqueci a senha vale para todos; para quem só tem Google, cria a primeira senha.
9. Troca de e-mail para um diferente do Google vinculado: desvincula o Google e desliga a agenda (com aviso antes).
10. Google sem e-mail verificado: sempre recusado.
11. Sem chaves do Google no painel dev: os botões do Google não aparecem.

Os comentários e testes citam essas regras pelo número.

## Painel do negócio (`/painel`)

Menu conforme capacidade e módulos (`src/ui/shells/painel-nav.ts`):

- **Início**: resumo do dia e lista do que falta configurar.
- **Agenda**: dia e semana por profissional; marcar, remarcar (inclusive arrastando), mudar situação, bloquear horário.
- **Clientes**: lista, ficha, pets do cliente, arquivar e restaurar.
- **Profissionais**: equipe, convites, papéis, expediente, folgas, serviços de cada um, foto.
- **Serviços**: catálogo com preço e tempo (único ou por animal e porte), pontos de fidelidade por serviço.
- **Fidelidade, Banners, Loja**: só com o módulo ligado.
- **Relatórios** (ou "Meus números" para o profissional), com exportação CSV.
- **Configurações**: negócio, aparência (marca), agenda (regras), animais, fechamentos (feriados), avisos.
- **Começar** (`/painel/comecar`): passos do primeiro acesso do dono: loja, marca, animais, serviços (com sugestões do
  nicho), expediente, equipe (opcional) e link da loja (QR e compartilhar).

## Agenda

- Regras da conta (`business_settings`): grade de horários, antecedência mínima, alcance máximo em dias, prazo para o
  cliente mudar ou cancelar, intervalo entre atendimentos, confirmação automática.
- **Só o cliente** segue as regras (grade, antecedência, alcance, prazo, expediente, folgas).
- **A equipe** marca em qualquer minuto, com duração livre (5 a 720 min). Conflito pede confirmação; confirmado, o
  agendamento que sobrepõe um normal vira **encaixe** (`is_squeeze_in`). Encaixe não entra na restrição de sobreposição e o
  cliente não o vê como tal. Quando um normal sai, os encaixes do intervalo são reavaliados.
- Situações: pendente, confirmado, concluído, cancelado, falta. Sem confirmação automática, o pedido do cliente fica pendente.
- Fuso e horário de verão: `docs/TEMPO.md`.

## Nicho pet

- Pets do cliente (`pets`): nome, espécie (cão ou gato), porte, raça, idade, pelagem, cuidados, foto.
- Variantes de preço (`PriceVariant`): `DOG_SMALL` (até 10 kg), `DOG_MEDIUM` (10 a 25), `DOG_LARGE` (25 a 45),
  `DOG_GIANT` (acima de 45) e `CAT`. Gatos são opcionais por conta (`servesCats`); desligados, a variante gato some.
- Serviço com `pricingMode` `SINGLE` (preço e tempo únicos) ou `BY_VARIANT` (por animal e porte, em `service_prices`).
  Elegibilidade, preço e tempo têm uma regra só: `domain/catalog/pricing.ts`.
- Conta nova sempre nasce pet shop. Conta sem nicho funciona com preço único e sem pets.

## Área do cliente (`/<slug>`)

- Para quem não é cliente: página pública da loja (serviços, entrar, cadastrar). Loja inativa: página "indisponível".
- **Cadastro** (`/<slug>/cadastro`), em quiz: nome → e-mail e senha → código enviado por e-mail → WhatsApp. Ou "Continuar com Google".
- **Quiz do pet** (`/<slug>/boas-vindas`): depois de entrar, loja pet sem pet ativo leva ao quiz (nome, espécie se a loja
  atende gatos, porte, raça, idade, pelagem, cuidados, foto).
- **Início**: próximo horário, banners, atalhos. **Agendar**: serviço, pet, profissional (ou "Qualquer um"), horário; sucesso com `.ics`.
- **Horários**: lista, detalhe, remarcar e cancelar dentro do prazo (fora do prazo, mostra o telefone da loja).
- **Pets**, **Prêmios** (Fidelidade) e **Loja** (Loja), estes dois dentro de **Mais**. Mais também tem avisos por e-mail,
  Minha conta e excluir a conta na loja.
- O tema segue a marca da loja (cores, logo, símbolo).

## Módulos opcionais

Ligados por conta pelo admin (aba Módulos no painel dev). Desligado, o menu some, a rota dá 404 e os dados ficam guardados.

- **Fidelidade** (`loyalty`): pontos por serviço creditados ao concluir o atendimento (estornados se desfeito), prêmios com
  resgate e entrega, ajuste manual, extrato, ranking opcional.
- **Banners** (`banners`): imagens com link no Início do cliente.
- **Loja** (`store`): produtos, categorias e imagens; carrinho, endereços (CEP pelo ViaCEP), frete pela Frenet ou retirada;
  pagamento pelo Mercado Pago (Pix e cartão); pedidos com prazo para pagar e vencimento automático; o dono marca a entrega.
  Estorno é feito no Mercado Pago.

## Avisos (e-mail)

Por e-mail (SMTP ou Resend). Para o cliente: confirmado, pedido de horário, remarcado, cancelado, lembretes de 24 h e 1 h,
concluído. Para a equipe: novo agendamento, cancelamento, remarcação. Dono e gerente podem receber os avisos de toda a loja
(Minha conta). Cada loja escolhe quais avisos manda (Configurações → Avisos); o cliente escolhe os seus (Mais). Também saem por
e-mail convite, redefinição de senha e códigos.

## Google Agenda

Só envio: os agendamentos de cada profissional viram eventos na agenda Google dele e acompanham remarcação e cancelamento.
Nada é lido do Google. Quem liga é a pessoa da equipe, em Minha conta, com o mesmo Google vinculado à conta. Escopo
`calendar.events`. Detalhes técnicos em `docs/ARQUITETURA.md`.

## Painel dev

- **Visão geral**: métricas da plataforma.
- **Contas**: criar (nicho pet, "atende gatos"), dados, equipe, marca, módulos, integrações (Mercado Pago, Frenet), regras,
  auditoria da conta, "entrar como".
- **Sistema**: execuções do agendador, avisos com falha ("tentar de novo"), e-mail de teste, **Google** (ID e segredo do cliente OAuth).
- **Auditoria** geral, **Admins** e perfil. `/vitrine`: vitrine de componentes (admin logado).
