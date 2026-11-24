# Pendências

O que continua aberto. Nenhum agente abriu as telas em navegador: só há testes automáticos e a fumaça por HTTP (`npm run smoke`).

## Para o dono conferir no navegador

- Todas as telas do painel dev e do app a 375 px (celular) e o foco nos diálogos.
- Painel dev: lista de contas, aba Módulos, aba Integrações, "tentar de novo" em /sistema, ações destrutivas (a confirmação exige JavaScript).
- Criar conta, convite, definir senha e entrar; "entrar como", faixa de suporte (contraste) e encerrar; convite de quem já tem senha em outra conta; desativar membro de várias contas.
- Agenda: arrastar a ficha (mouse, teclado e folha), telefone da lista de Clientes abaixo de 28 rem, envio da foto da equipe e do logo, exportação do CSV de relatórios.
- Módulos: telas de Fidelidade, Banners e Loja, envio de imagens (também sem JavaScript), pedido com "Simular pagamento aprovado".
- Entrada do app sem JavaScript.
- Fase 1 (endereço único, pessoa única e Google), no `APP_HOST`:
  - Entrar em `/entrar` como dono, equipe e cliente: cada um cai no destino certo (painel, loja, "sem loja").
  - Cadastro pela loja (`/<slug>/cadastro`) com código de e-mail, e "Usar minha conta" numa segunda loja.
  - Convite da equipe e redefinição de senha por link, com senha e com Google; links antigos `painel.` e `/definir-senha/<t>` redirecionando (308).
  - Minha conta inteira (`/conta`): nome, e-mail com código, senha, vincular e desvincular Google, avisos de toda a loja; sem trancar a pessoa fora.
  - `/google/falso` com `INTEGRATIONS_MODE=fake`: entrar, cadastrar e vincular pelo Google simulado.
  - Painel dev em Sistema → Google: salvar e remover as chaves; sem chaves o botão do Google some.
  - Tudo a 360 px, com foco visível e movimento reduzido.

## Fase 2 (pet e agenda): entregue e o que fica

- Entregue: nicho pet, pets, preço e tempo por animal e porte, agenda da equipe livre com confirmação e encaixe, telas do painel.
- Fase 3: o quiz usa `NICHES.PET.quiz`; a área do cliente usa `listMyPets`, `listServicesForPet`, `fromPrice` e `getAvailability({ petId })`.
- Fase 4: `serviceSuggestions` no começo do dono (`/painel/comecar`) e a demo com pets de portes variados e um encaixe (entregues).
- Conferir no navegador: `/painel/comecar` a 360 px (tabela de serviços por porte, expediente, QR e Compartilhar), prévia da marca ao vivo, envio da logo e foco ao trocar de passo.
- Conferir no navegador: folha de marcar a 360 px (pets em rolagem), diálogo "Confirme o horário", encaixe na grade do dia e na semana.

## Fase 3 (área do cliente): entregue e o que fica

- Entregue: acesso e domínio do cliente, tema da loja, moldura, página pública, Prêmios e Loja; vitrine, Início, "Agendar de novo",
  remarcar e `.ics` já usam pet, preço por porte e o nicho reais.
- Falta: quiz e boas-vindas (`/<slug>/boas-vindas`), pets, agendar, Horários, Início definitivo (troca `InicioProvisorio`) e a
  tela Mais completa. `needsPetQuiz` (`src/server/auth/pet-onboarding.ts`) continua devolvendo `false` até a rota de boas-vindas
  existir; depois, troca o corpo por `getNicheSettings` (nicho pet) e `listMyPets` (nenhum pet ativo).
- A fumaça (`scripts/smoke-pages.ts`) ainda não pede as telas do cliente (Prêmios, Loja, pedidos): precisa de uma sessão de cliente.

## Antes de abrir a loja (Mercado Pago real)

- Mercado Pago, Frenet e ViaCEP reais nunca foram chamados (só as falsas). Testar com credenciais de teste: Pix (expiração mínima de 30 minutos), cartão, webhook e assinatura `x-signature` (roteiro em `docs/PUBLICACAO.md`).
- Sem avisos de e-mail para pedido, pagamento, resgate; sem estorno automático (o dono estorna no Mercado Pago); boleto fora do checkout.
- Rotação da chave de cifra dos segredos de integração (hoje derivada do `APP_SECRET`).

## Depois

- Segurança: CSP completa com nonce e cookies com prefixo `__Host-` (precisam de navegador para conferir).
- Várias instâncias exigem `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` fixa (a partida avisa).
- Medir com tráfego real: limite geral de 120/min por chave e IP; gravação de métricas em lote grande × tamanho do pool; espera da trava por profissional (segura uma conexão do pool por até 15 s).
- PgBouncer em modo transação pode ignorar `-c timezone=UTC`: conferir contra a URL de produção (a partida confere e recusa).
- Telefone estrangeiro digitado sem `+` e com 10 ou 11 dígitos é tratado como brasileiro: dica na tela.
- Agenda: o conjunto de profissionais do resumo difere do da agenda em dois casos limite; `listClosures` precisa de visão por ator antes de virar rota; `updateRulesAsAdmin` grava fora de `updateSchedulingRules` (unificar se o caminho do dono ganhar efeito colateral).
- Relatórios: `byDay` faz uma agregação por dia local (até 366); se pesar, uma consulta única com `AT TIME ZONE`. `orders` não tem índice em `paid_at` (usado nas métricas da loja).
- Entrega de aviso é "pelo menos uma vez": processo morto no meio do envio reenvia em 2 min.
- Interface: `Sheet` sem teste de rolagem travada e `aria-modal`; `Tabs` com `href` como navegação com `aria-current`; `Dialog` intercepta Esc de filhos; barra da base do celular deixa de grudar com ancestral `overflow`.
- Falha de disco na rota de arquivos vira 404 sem registro; teste dos cabeçalhos de `/arquivos` com o servidor rodando.
- `tsx --conditions=react-server` vale para o processo todo do seed e do `dev`: se o domínio importar `react-dom/server`, separar `createTenantContext` de `server-only`.
- Migrações: gerar sempre o diff de schema para schema (índices parciais e FKs compostas); afirmar o nome do CHECK nos testes negativos.
- Banco embutido: escutar só em 127.0.0.1 e parar quando um passo posterior ao start falha.
- Telefones de demonstração são fictícios, mas não há faixa reservada no Brasil.
- Devolvidas da revisão do fechamento (conferidas no código):
  - `isUniqueViolation` olha só o código `P2002`; `team/professionals.ts` não confere o alvo (qual índice único).
  - `labelOfMinute` (`ui/components/planner/drag-math.ts`) repete `minuteLabel` do servidor sem comentário que explique a duplicação.
  - `scripts/dev.ts` registra `SIGINT`/`SIGTERM` só depois de subir o banco e o Next: Ctrl+C durante a partida deixa o banco ligado.
  - Agenda no celular: com uma coluna visível, a seta para o lado em teclado físico pode mover a prévia para uma coluna oculta (`use-drag-reschedule.ts`).
  - `Tabs` com `href` são links sem `aria-current`; abas a 375 px sem pista de rolagem; aba inativa descola 1 px no hover.
  - Anel de foco depende do contêiner (papel dentro de capa, `Checkbox` sobre capa); `Dialog` e Esc de filhos a conferir no navegador.
  - "GET / 404" no log quando uma ação redireciona atrás do proxy; `occupancy` do resumo da agenda limitado a 1 por exibição.
  - Para o dono conferir no navegador: todas as telas a 375 px, foco nos diálogos, arrastar a ficha na agenda (mouse, teclado e folha), prévia com cores extremas, envio de foto da equipe e do logo, CSV de relatórios.
- Vouchers saíram do banco (migração `20261123030000_remove_vouchers`): os arquivos de imagem de parceiros e vouchers já apagados ficam no disco de uploads; limpar à mão no servidor, se quiser o espaço.
