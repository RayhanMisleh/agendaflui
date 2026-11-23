# App único na web, foco em pet shop

## Intenção

Reunião dos sócios (23/11): o AgendaFlui passa a ser **um endereço só, `app.agendaflui.com.br`**, na web, para o dono, a equipe e os clientes. O app nativo (repositório `agendaflui-app`) fica parado; a API do app sai. O sistema decide sozinho quem a pessoa é (equipe ou cliente) pelo cadastro dela — nunca existe a tela "sou cliente / sou profissional". O cliente chega pelo link da loja (`app.agendaflui.com.br/<slug>`). Entra o login com Google e a ligação com o Google Agenda.

O primeiro nicho é **pet shop**, e só ele aparece agora, mas o código separa o que é do nicho (porte, espécie, quiz, sugestões de serviço) do que é do sistema, para outros nichos entrarem depois sem refazer nada.

O diferencial pedido pelo dono é ser **prático, sem contradições e sem dor de cabeça**, com acabamento profissional: completo, chamativo, fluido e com animações. Entrega rasa é fracasso.

## Metas

1. **Endereço único.** `app.agendaflui.com.br` serve tudo: entrada, área do cliente de cada loja e painel da loja. `dev.agendaflui.com.br` continua para nós (admins). `painel.agendaflui.com.br` redireciona para o novo endereço. `api.agendaflui.com.br` sai.
2. **Cadastro único de pessoa.** Uma pessoa = uma conta (e-mail, senha e/ou Google). O papel vem dos vínculos: equipe de uma loja (vínculo já existente, um ativo por pessoa) e/ou cliente de uma ou mais lojas.
3. **Login com Google** com as regras de vínculo abaixo, sem caso contraditório.
4. **Google Agenda (só enviar):** os agendamentos do profissional aparecem na agenda Google dele e acompanham remarcação e cancelamento.
5. **Nicho pet shop:** pets do cliente, espécies atendidas configuráveis, preço e tempo de serviço por animal e porte.
6. **Agenda:** regras (grade, antecedência, alcance, prazo de mudança, intervalo, expediente) só para o cliente; o profissional marca em qualquer minuto, com qualquer duração, e faz encaixe.
7. **Área do cliente na web** completa, com a marca da loja: início, agendar, meus horários, meus pets, prêmios, loja, minha conta; cadastro com quiz do pet.
8. **Onboarding do dono** no primeiro acesso.
9. **Termos fixos:** sempre "Profissional/Profissionais", "Cliente/Clientes", "Pontos", "Clube". Some a personalização de termos.
10. **Painel dev:** sai o bloco "API e avisos nas últimas 24 horas" (o tile de avisos na fila pode ficar, sem a parte de API); a criação de conta mostra só o nicho "Pet shop", sempre marcado (cartão destacado em Caramelo), com a opção "Atende gatos"; entra a tela das chaves do Google.
11. **Módulos** (fidelidade, banners, loja) continuam ligáveis por conta.

## Não-metas

- App nativo e push no celular (sem app, não há push; avisos vão por e-mail).
- Outros nichos agora (só a estrutura que os permite).
- Google Agenda nos dois sentidos (ler compromissos do Google para bloquear horários).
- Domínio próprio por loja.
- Pagamento de agendamento online (só a loja de produtos, que já existe, usa Mercado Pago).

## Anti-metas (fracasso mesmo funcionando)

- Qualquer caminho em que a mesma pessoa tenha duas contas, ou em que um Google aponte para uma pessoa e o e-mail dele para outra.
- Uma pessoa ficar trancada fora (sem senha e sem Google) por uma ação dela mesma.
- Cliente ver ou mexer em dado de outra loja ou de outro cliente; cliente ver encaixe ou dado interno.
- Nome de loja colidir com rota do sistema.
- Tela crua, sem estado vazio, sem carregamento, sem resposta ao toque; animação que atrapalha ou ignora `prefers-reduced-motion`.
- Texto com "Tutor", "Tosador", "Patinhas" ou termo de outro ramo; rastro de "API do app" nas telas.

## Abordagens consideradas

1. **Endereços separados por público** (`painel.` para a equipe, `app.` para o cliente) com conta única. Isola sessão e rotas por natureza. O dono ouviu a recomendação e **escolheu o endereço único**.
2. **Endereço único com o painel na raiz** (`/agenda`, `/clientes`) e as lojas em `/<slug>`: lista de nomes proibidos crescendo para sempre e colisão a cada tela nova. Descartada.
3. **Endereço único com o painel sob `/painel`** e as lojas em `/<slug>` (**escolhida**): uma lista curta e fixa de nomes reservados, uma sessão por pessoa, e o painel isolado num prefixo.

Também foi descartado manter a API v1 parada: cada mudança de domínio (pets, porte, identidade) teria de ser repetida nela e nos testes dela sem ninguém usar. Ela sai inteira; o histórico do git guarda o código para quando o app voltar, e o app volta sobre o modelo novo.

## Endereços e rotas (`app.agendaflui.com.br`)

| Caminho | O quê |
|---|---|
| `/` | Sem sessão: vai para `/entrar`. Com sessão: decide (ver "Para onde a pessoa vai"). |
| `/entrar` | Entrada geral (e-mail e senha, ou Google). |
| `/esqueci-a-senha`, `/redefinir-senha/[token]` | Redefinição por link, para qualquer pessoa. |
| `/convite/[token]` | Ativar convite da equipe: criar senha ou continuar com Google. |
| `/conta` | Minha conta (qualquer pessoa): nome, e-mail, senha, Google vinculado, Google Agenda (equipe), sair. |
| `/google/entrar`, `/google/retorno` | Início e retorno do OAuth do Google. |
| `/painel/**` | Painel da loja (tudo o que hoje é `painel.`), exige vínculo de equipe ativo. |
| `/painel/comecar` | Onboarding do dono. |
| `/[slug]` e `/[slug]/**` | Área do cliente da loja. |
| `/webhooks/mercadopago/[key]` | Webhook do Mercado Pago (hoje em `api.`). |
| `/arquivos/**`, `/brand/**`, `/_next/**`, `/healthz` | Como hoje. |

Nomes reservados para slug (lista única, usada pela validação e pelo teste estrutural): `entrar, sair, conta, convite, cadastro, esqueci-a-senha, redefinir-senha, definir-senha, google, painel, webhooks, arquivos, brand, healthz, api, dev, admin, www, suporte, app, ajuda, termos, privacidade`. Loja existente com slug reservado não existe hoje (só `demo`); a migração confere e falha com mensagem clara se existir.

`painel.agendaflui.com.br/<caminho>` responde 308 para o caminho equivalente no novo endereço (`/` → `/painel`, `/entrar` → `/entrar`, `/definir-senha/<t>` → `/convite/<t>`, `/redefinir-senha/<t>` → `/redefinir-senha/<t>`, outros → `/painel/<caminho>`), para os e-mails já enviados continuarem funcionando. Variáveis: `APP_HOST` (novo) substitui `PAINEL_HOST`, `API_HOST`, `APP_WEB_URL` e `APP_WEB_ORIGINS`; `LEGACY_PAINEL_HOST` opcional liga o redirecionamento. Todos os links gerados (e-mail, QR, link para clientes) usam `APP_HOST`.

Segurança por estar tudo num endereço: um único cookie de sessão `httpOnly`, `SameSite=Lax`, `Secure`; cabeçalhos de segurança de hoje mantidos; ações e páginas de `/painel/**` sempre reconferem o vínculo de equipe e as de `/[slug]/**` o vínculo de cliente com aquela loja (nada confia na URL sozinha).

## Pessoa, papéis e sessão

**Modelo.** `User` vira "pessoa" (tabela global): `email` único, `passwordHash?`, `emailVerifiedAt?`, `googleSub?` (único), `googleEmail?`, `googleLinkedAt?`, nome, foto. `Customer` (por loja) ganha `userId?` com único `(business_id, user_id)`: cliente com conta tem `userId`; cliente de balcão (cadastrado pela equipe, sem conta) não tem. O que é da loja (observações internas, clube, pontos, pedidos, endereços, histórico) continua no `Customer`. Saem de `Customer`: `passwordHash`, `emailVerifiedAt`. O e-mail de contato do cliente de balcão fica em `Customer.email`; para cliente com conta, o e-mail é o da pessoa.

**Princípio da conta pendente.** Pessoa sem senha e sem Google é "conta pendente" (hoje só nasce de convite). Qualquer prova de posse do e-mail ativa a conta pendente: o link do convite, o código enviado ao e-mail (cadastro de cliente) ou um Google com aquele e-mail verificado. Conta com ao menos uma forma de entrar (senha ou Google) é "conta ativa". Toda conta ativa tem `emailVerifiedAt` (a migração marca como verificados os da equipe que já criaram senha, porque o convite provou o e-mail, e copia a verificação dos clientes do app).

**Campos da pessoa e da loja.** O e-mail de um cliente com conta é o da pessoa: `Customer.email` continua preenchido (cópia mantida igual ao e-mail da pessoa na mesma transação que o troca, em todas as lojas), para o índice único por loja seguir impedindo um cliente de balcão duplicado. A equipe não edita o e-mail de cliente com conta ("O e-mail é da conta do cliente"); edita nome, telefone, nascimento, observações e clube, que são da loja. O cliente, em Minha conta, edita nome e telefone da pessoa, e isso atualiza nome e telefone dele em todas as lojas.

**Migração dos clientes com senha.** Para cada `Customer` com `passwordHash`: se já existe `User` com o mesmo e-mail, liga a ele (a senha da pessoa prevalece; a do cliente é descartada e isso vai para o relatório); senão cria o `User` com a senha e o `emailVerifiedAt` do cliente. Produção hoje: 1 cliente com senha (conta demo), nenhum e-mail repetido.

**Sessão.** Um cookie de sessão para todos os papéis (tabela `sessions` atual), 30 dias; a pessoa pode estar entrada em vários aparelhos ao mesmo tempo (entrar num não derruba o outro; trocar senha derruba todos). O modo suporte (admin "entrar como" na loja) continua como hoje, levando a `/painel`.

**Para onde a pessoa vai** (função única de domínio, testada caso a caso):
- Em `/` ou depois de `/entrar`: se tem vínculo de equipe ativo → `/painel`. Senão, se é cliente de uma loja → `/<slug>`. De várias → a última loja usada (guardada na sessão), com troca de loja em "Minha conta". De nenhuma → tela "Sua conta ainda não está em nenhuma loja. Entre pelo link que a sua loja enviou."
- Só abrir `/<slug>` com sessão não torna ninguém cliente: a página da loja mostra "Usar minha conta nesta loja" (com o que será compartilhado: nome, e-mail, telefone). Entrar ou cadastrar por `/<slug>/entrar`, ou tocar em "Agendar"/"Usar minha conta", é a escolha explícita. Aí: se a pessoa ainda não é cliente da loja, vira cliente ali (cria o `Customer` ligado, ou adota o de balcão com o mesmo e-mail se a pessoa tem e-mail verificado) e segue para o quiz. Se ela é da equipe daquela loja, a área do cliente mostra um atalho "Abrir painel".
- A loja suspensa ou inexistente mostra a página "Loja indisponível", nunca erro cru.

**Cadastro de cliente com e-mail e senha** (só pelo link da loja): nome, e-mail, telefone, senha → código de 6 dígitos por e-mail (o mecanismo de hoje) → conta criada e verificada → quiz. Se o e-mail é de conta ativa: "Este e-mail já tem conta. Entre com ela." (nunca cria segunda conta). Se é de conta pendente, o código confirma o e-mail e o cadastro ativa a conta pendente com a senha escolhida (os convites dela são consumidos). Esqueci a senha passa a ser por link para todos (o fluxo de código do app sai): qualquer pessoa existente recebe o link, que define a senha (para conta pendente, isso também a ativa).

**Convite da equipe.** O convite continua por e-mail, agora para `/convite/<token>`. Se o e-mail convidado já é de uma pessoa com conta (por exemplo, já era cliente), ela recebe o aviso "Você entrou para a equipe da loja X. Entre com a sua conta." e o vínculo nasce ativo, sem novo cadastro. A regra de um vínculo ativo por pessoa continua.

## Login com Google — regras (sem exceção)

O vínculo é pela identidade fixa da conta Google (`sub`), nunca pelo e-mail.

Invariantes: um Google (`sub`) liga a no máximo uma pessoa; uma pessoa tem no máximo um Google; no momento de vincular, o e-mail verificado do Google é igual ao e-mail da pessoa, e a pessoa não pode ficar com e-mail diferente do Google vinculado (ver 9).

1. **Google vinculado** → entra na pessoa dona do vínculo e segue a regra de destino (o `googleEmail` guardado é atualizado; mudança de e-mail feita no lado do Google não muda a pessoa).
2. **Google não vinculado e o e-mail dele é de conta ativa** → não entra. Mensagem: "Este e-mail já tem conta no Agenda Flui. Entre com a sua senha e vincule o Google em Minha conta." Vale para equipe e cliente.
2b. **Google não vinculado e o e-mail dele é de conta pendente** → o Google prova o e-mail: vincula, ativa a conta e consome os convites (mesmo efeito de abrir o convite).
3. **Ativar convite** (`/convite/<token>`): "Criar senha" ou "Continuar com Google". O Google só é aceito se o e-mail dele for igual ao do convite e estiver verificado pelo Google e se esse Google não estiver ligado a outra pessoa ("Este Google já está ligado a outra conta."); o vínculo nasce feito e o convite é consumido.
4. **Cliente novo pelo link da loja**: "Continuar com Google" cria a pessoa (e-mail verificado pelo Google) já vinculada, cria o cliente na loja (ou adota o de balcão com o mesmo e-mail) e leva ao quiz.
5. **Google desconhecido na entrada geral** (sem link de loja) → não cria conta: "Não achamos uma conta com este Google. Se você é cliente, entre pelo link que a sua loja enviou."
6. **Vincular em Minha conta** → só aparece para quem não tem Google vinculado (para trocar, desvincula antes). Só aceita conta Google cujo e-mail verificado seja igual ao e-mail da pessoa. Se o Google já está vinculado a outra pessoa: "Este Google já está ligado a outra conta."
7. **Desvincular** → só se a pessoa tem senha. Sem senha: "Crie uma senha antes de desvincular, para não perder o acesso." (botão leva a criar senha). Desvincular também desliga o Google Agenda.
8. **Esqueci a senha** → funciona para todos; para quem só tem Google, o link cria a primeira senha.
9. **Troca de e-mail da pessoa** (em Minha conta, com código no e-mail novo) → se a pessoa tem Google vinculado e o e-mail novo é diferente do e-mail do Google, a troca desvincula o Google e desliga o Google Agenda, com aviso antes de confirmar ("O Google vinculado usa outro e-mail e será desvinculado."). Por isso, quem só tem Google precisa criar uma senha antes de trocar o e-mail. Assim nunca sobra um Google apontando para uma pessoa enquanto o e-mail dele é de outra conta.
10. **Google sem e-mail verificado** → recusado em todos os casos.
11. **Google não configurado** (sem chaves no dev) → o botão "Continuar com Google" e o vínculo simplesmente não aparecem.

Implementação: OpenID Connect com fluxo de código + PKCE, `state` e `nonce` num cookie curto assinado; o `id_token` é conferido (assinatura pelas chaves públicas do Google, `iss`, `aud`, `exp`, `nonce`, `email_verified`). A intenção do fluxo (entrar, cadastrar na loja X, ativar convite T, vincular, ligar agenda) viaja no estado assinado, nunca na URL aberta. Limites de tentativa como os do login.

**Chaves do Google no dev.** Nova tela em Sistema → "Google": ID do cliente e segredo do cliente, guardados numa tabela de plataforma com o segredo selado (mesmo `secret-box`, AAD `platform:google:client_secret`); a tela mostra a URL de retorno para copiar (`https://<APP_HOST>/google/retorno`), os últimos 4 caracteres e quando foi salvo, nunca o segredo. Só admin. A leitura em texto puro fica num leitor restrito, como o das integrações.

## Google Agenda (só enviar)

- Em Minha conta, quem é da equipe e tem Google vinculado vê "Google Agenda: Ligar". Ligar pede a permissão `calendar.events` (autorização incremental, acesso offline). O token de renovação fica selado por pessoa.
- Os agendamentos do profissional ligado à pessoa (criar, remarcar, ajustar duração/serviços, cancelar, faltou) viram eventos na agenda principal dela: título "Banho · Rex (Cão médio)", horário, observação do cliente e link para o agendamento no painel; marcados com o id do agendamento para atualizar e apagar.
- O envio passa por uma fila no banco processada pelo agendador que já existe (com repetição e espera crescente); a gravação do agendamento nunca espera o Google. Ao ligar, os agendamentos futuros já existentes entram na fila.
- Se o Google recusar o token (revogado), a ligação vira "Desligada — ligue de novo" em Minha conta, sem quebrar nada.
- Para o dono: a permissão de agenda exige verificação do app no Google para uso amplo; até lá o Google mostra o aviso de app não verificado. Isso entra na documentação de publicação.

## Nicho pet shop

**Estrutura de nicho.** `Business.niche` (enum, hoje só `PET`) substitui o texto livre `segment`. Um registro de nichos no código (`src/server/niches/`) define, por nicho: nome, as variantes de preço (para pet: `DOG_SMALL`, `DOG_MEDIUM`, `DOG_LARGE`, `DOG_GIANT`, `CAT`), as opções da conta (pet: `servesCats`), as perguntas do quiz, as sugestões de serviço do onboarding e os textos do assunto ("pet"). Telas e domínio leem o nicho por esse registro, sem `if (pet)` espalhado.

**Portes** (rótulo e faixa mostrados no quiz e nas tabelas): Pequeno até 10 kg; Médio 10 a 25 kg; Grande 25 a 45 kg; Gigante acima de 45 kg. Gato tem uma variante só.

**Opções da conta.** `servesCats` (padrão: desligado), editável na criação da conta no dev, no onboarding do dono e em Configurações. Desligar gatos não apaga preços de gato nem pets gatos: os serviços só deixam de oferecer gato ao cliente e a tabela esconde a linha; religar traz tudo de volta. Com gatos desligados: o quiz não pergunta espécie (é cão); o cliente vê seus gatos em Meus pets com "A loja não atende gatos no momento" e não consegue agendar para eles; a equipe continua podendo agendar um gato (regra livre da equipe), usando a linha de gato do serviço ou o preço único. Uma função única de domínio decide se um serviço é oferecido para um pet: `SINGLE` oferece a qualquer pet; `BY_VARIANT` só com linha da variante; e variante `CAT` só para a equipe ou com `servesCats` ligado.

**Pet** (tabela de conta): cliente, nome, espécie (cão/gato), porte (obrigatório para cão, vazio para gato), raça (texto, com sugestões; "Sem raça definida"), nascimento aproximado (mês/ano), pelagem (curta/média/longa), cuidados e comportamento (texto), foto opcional, arquivado. Cliente tem vários pets; cliente e equipe editam.

**Preço por animal e porte.** Cada serviço tem `pricingMode`: `SINGLE` (preço e tempo únicos, como hoje) ou `BY_VARIANT` (uma linha por variante do nicho com preço e tempo; variante sem linha = "não atende"). Com `BY_VARIANT` precisa haver ao menos uma linha. Na tela de serviços: alternância "Preço único / Por animal e porte" e a tabela (linha de gato só com `servesCats`).

**Agendamento com pet.** Em conta de nicho pet, todo agendamento tem um pet (cliente e equipe). O preço e o tempo de cada item vêm da variante do pet (porte do cão ou gato); serviço sem linha para aquela variante não aparece/é recusado. O item guarda a variante, o preço e o tempo usados (foto do momento): mudar a tabela ou o porte do pet depois não altera agendamentos já feitos. Profissional elegível continua sendo quem faz todos os serviços escolhidos.

## Agenda: regras só para o cliente, encaixe e duração livre

- **Cliente:** valem grade (`slotStepMin`), antecedência mínima, alcance máximo, prazo de mudança, intervalo entre atendimentos, expediente, bloqueios e dias fechados (como hoje).
- **Equipe:** nada disso vale. Início em qualquer minuto; **duração livre** (preenchida pela soma dos itens; a equipe pode mudar para qualquer valor de 5 a 720 minutos, em minutos inteiros), na marcação, no ajuste e na remarcação.
- **Confirmação, nunca silêncio:** quando a equipe marca/remarca/ajusta caindo em horário ocupado, bloqueio, fora do expediente ou dia fechado, o sistema devolve o que há ali ("14:00–15:00 já tem Rex (Banho)", "Fora do expediente de Ana", "Loja fechada neste dia") e pede confirmação. Confirmado, grava.
- **Encaixe:** agendamento ativo da equipe que se sobrepõe a um agendamento **normal** ativo do mesmo profissional é gravado com `isSqueezeIn = true`; se só se sobrepõe a encaixes, fica normal (a equipe confirma a sobreposição do mesmo jeito). A trava do banco (`appointments_no_overlap`) passa a valer só entre agendamentos normais: dois normais sobrepostos continuam impossíveis, inclusive na corrida entre dois pedidos. Remarcar/ajustar recalcula a marca do próprio agendamento. Quando um normal deixa de ocupar um intervalo (cancelado, faltou, remarcado, encurtado), os encaixes que se sobrepunham a ele são reavaliados na mesma transação, em ordem de início: cada um que não se sobrepõe mais a nenhum normal (contando os já promovidos) volta a ser normal. Desfazer "concluído/faltou" que volte a sobrepor um normal pede confirmação e vira encaixe. Agendamento feito pelo cliente nunca é encaixe (o cliente só vê horário livre).
- **Cliente nunca vê encaixe:** para a disponibilidade, encaixes ocupam o horário como qualquer agendamento.
- **Agenda do painel:** agendamentos sobrepostos aparecem lado a lado (colunas dentro do horário), encaixe com marca visível; arrastar para remarcar segue as mesmas regras (confirmação quando cair sobre ocupado).

## Área do cliente (`/<slug>`)

Mobile primeiro, com a marca da loja (logo, nome, cor primária com contraste garantido, como `storePalette` do app) e o "feito com Agenda Flui" discreto. Módulo desligado some do menu. Navegação inferior no celular: Início, Agendar, Horários, Pets, Mais (Prêmios, Loja, Minha conta).

- **Sem sessão:** página da loja (capa com logo e nome, serviços com faixa de preço "a partir de", botão "Agendar"); agendar pede entrar/cadastrar e volta ao ponto.
- **Entrar / Cadastrar:** abas, Google em destaque, e-mail e senha, código de verificação.
- **Quiz do pet** (`/<slug>/boas-vindas`, logo após o cadastro, e "Adicionar pet" depois): uma pergunta por tela com barra de progresso e transição animada; nome → espécie (só se a loja atende gatos) → porte (cartões ilustrados com faixa de peso) → raça (busca com sugestões e "Sem raça definida") → idade aproximada → pelagem → cuidados e comportamento (opções rápidas + texto: "Medo de secador", "Alergia", "Agitado", "Idoso") → foto (opcional) → resumo e "Adicionar outro pet" ou "Agendar agora". Pode voltar sem perder respostas; pular o opcional.
- **Início:** saudação com o pet, próximo horário em destaque (com remarcar/cancelar dentro do prazo), banners, atalho "Agendar de novo".
- **Agendar:** pet → serviços (preço e tempo do porte daquele pet) → profissional ("Qualquer um" ou um) → dia (faixa de dias) e horários livres → confirmar (resumo, observação) → tela de sucesso animada com "Adicionar à minha agenda" (arquivo .ics).
- **Meus horários:** próximos e anteriores, status, cancelar/remarcar no prazo (fora do prazo: texto com o prazo e contato da loja).
- **Meus pets:** cartões, editar, arquivar, adicionar.
- **Prêmios** (módulo fidelidade): saldo, extrato, prêmios, resgatar (gera resgate pendente para o balcão).
- **Loja** (módulo loja): vitrine, produto, carrinho, endereço, frete, checkout Mercado Pago, pedidos — paridade com o que o app fazia sobre o domínio existente.
- **Minha conta:** dados, senha, Google, preferências de e-mail, trocar de loja (se cliente de várias), excluir conta (anonimiza o cliente naquela loja e desliga a pessoa dele; se a pessoa não tem mais nenhum cliente em loja nenhuma e nenhum vínculo de equipe em qualquer estado, a pessoa é apagada e as sessões dela caem).

## Onboarding do dono (`/painel/comecar`)

No primeiro acesso do dono (e enquanto não concluído ou dispensado), um passo a passo com progresso salvo, pode pular e voltar: dados da loja → marca (logo e cores, com prévia ao vivo) → animais atendidos (gatos sim/não) → serviços sugeridos para pet shop (Banho, Banho e tosa, Tosa higiênica, Hidratação, Corte de unha) com a tabela por porte já preenchida com valores de exemplo para ajustar, desmarcar ou adicionar → expediente (o dono também é profissional? horários da semana) → equipe (convidar por e-mail, opcional) → link e QR para os clientes, com "Copiar" e "Compartilhar". O Início do painel mostra a lista do que falta até concluir.

## Painel dev

- Visão geral: sai o bloco de API (requisições e taxa de erro); avisos na fila continuam.
- Criar conta: o passo "Termos" sai; entra o passo "Nicho" com um único cartão "Pet shop" marcado e destacado (Caramelo), não desmarcável, e a opção "Atende gatos". As regras da agenda continuam (são do cliente).
- Conta: a aba "Termos" sai; integrações mostram a URL do webhook no novo endereço.
- Sistema → Google: chaves do Google (acima).

## O que sai do sistema

API v1 inteira (rotas, OpenAPI, tokens de acesso e renovação, CORS, medição de uso e tabela `api_usage_hourly`, `APP_WEB_ORIGINS`), dispositivos e o canal de push (Expo), verificação por código para redefinir senha de cliente, termos personalizáveis (colunas e telas), `Business.segment`, `PAINEL_HOST`/`API_HOST`/`APP_WEB_URL`. O webhook do Mercado Pago muda para o novo endereço. Os avisos da equipe que iam por push (`notifyAllAppointments`) passam a ir por e-mail.

## Qualidade, visual e movimento

- Marca Agenda Flui (`../branding/`, tokens já no código: Água, Caramelo, Tinta, Bolha, Espuma; Bricolage Grotesque + Figtree; cantos 10/16/28/pílula) no sistema; a área do cliente aplica a cor da loja por cima, com contraste conferido.
- Movimento com propósito: transição entre páginas (View Transitions já existentes), entre perguntas do quiz (deslizar + leve escala), seleção de cartões (porte, serviço, horário) com resposta ao toque, contador e barra de progresso, sucesso do agendamento com um momento de celebração, esqueletos em todo carregamento. Só `transform`/`opacity`; tudo desligado com `prefers-reduced-motion`.
- Toda tela com estado vazio que convida à ação, erro que diz o que fazer, carregamento, foco visível e funcionamento a partir de 360 px de largura.
- Ilustrações próprias simples (SVG em traço, no estilo dos ícones Lucide) para portes, espécies e estados vazios.

## Dados de demonstração

`npm run demo:create` recria "Focinho Feliz Pet Shop" no modelo novo: serviços por porte, gatos ligados, clientes com pets de portes variados, agendamentos (inclusive um encaixe), fidelidade, banners e loja.

## Restrições

- Regras do projeto (`AGENTS.md`): domínio só em `src/server/`, `tenantDb`, `ctx.clock()`, `z` de `@/server/domain/errors`, tempo por `src/server/time/`, travas por `$lockKey` na ordem de `docs/ARQUITETURA.md`, segredos só por leitor restrito, `requireModule`, tabela nova classificada em `models.ts`, sem `any`.
- Verificação: `npm run typecheck && npm run lint && npm test && npm run build`. Sem testes de navegador (o dono confere).
- Migrações em SQL com transação; produção tem só a conta `demo`.
- Documentação enxuta: atualizar `ARQUITETURA.md`, `PUBLICACAO.md`, `.env.example`, `README.md` e `AGENTS.md` (hosts), sem histórico.
- Publicar no Coolify (autorizado pelo dono nesta leva): domínio `app.agendaflui.com.br` (DNS já aponta para o servidor), `painel.` mantido só para redirecionar, `api.` removido.

## Decisões de quem escreveu (para o dono conferir)

- Painel sob `/painel` no endereço único; lista fixa de nomes reservados.
- API v1 e push saem (o dono disse que não usarão mais a API); o app nativo, quando voltar, terá uma API nova sobre este modelo.
- Uma sessão por pessoa, 30 dias, cookie único.
- Redefinição de senha por link para todos.
- Faixas de porte por peso (acima); porte obrigatório para cão.
- Gatos desligados por padrão.
- Todo agendamento de conta pet tem pet.
- Duração livre da equipe de 5 a 720 minutos.
- Google Agenda na agenda principal da pessoa, com a permissão `calendar.events`.
- Excluir conta de cliente anonimiza o cliente na loja; a pessoa só é apagada se não sobrar vínculo.
- Conta pendente é ativada por qualquer prova de posse do e-mail (convite, código, Google verificado).
- Trocar o e-mail desvincula um Google de e-mail diferente.
- Entrar numa loja como cliente exige ação explícita; só visitar a página não compartilha dados.
- Encaixe é definido pela sobreposição com agendamento normal, com reavaliação quando o normal sai.
- Gatos desligados: cliente não agenda gato; equipe pode.

## O que fica para quem constrói

Divisão de arquivos e componentes; textos exatos de cada tela (voz da marca: curta, verbo na frente, "você"); ilustrações; nomes de colunas e enums não fixados aqui; layout das colunas de encaixe no planner; ordem interna das fases desde que cada uma termine verificável.
