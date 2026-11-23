# Pendências

O que continua aberto depois das Fases 1 a 6. Nenhum agente abriu os painéis em navegador: só há testes automáticos e a fumaça por HTTP (`npm run smoke`).

## Para o dono conferir no navegador

- Todas as telas dos dois painéis a 375 px (celular) e o foco nos diálogos.
- Painel dev: lista de contas, aba Módulos, aba Integrações, "tentar de novo" em /sistema, ações destrutivas (a confirmação exige JavaScript).
- Criar conta, convite, definir senha e entrar; "entrar como", faixa de suporte (contraste) e encerrar; convite de quem já tem senha em outra conta; desativar membro de várias contas.
- Agenda: arrastar a ficha (mouse, teclado e folha), telefone da lista de Clientes abaixo de 28 rem, envio da foto da equipe e do logo, exportação do CSV de relatórios.
- Módulos: telas de Fidelidade, Banners e Loja, envio de imagens (também sem JavaScript), pedido com "Simular pagamento aprovado".
- Entrada do painel do negócio sem JavaScript.
- Testes de navegador (`npm run test:e2e`): não rodam desde a Fase 2B; `entrada.spec.ts` e `vitrine.spec.ts` foram ajustados sem rodar. Rodar, corrigir e ampliar.

## Antes de abrir a loja (Mercado Pago real)

- Mercado Pago, Frenet e ViaCEP reais nunca foram chamados (só as falsas). Testar com credenciais de teste: Pix (expiração mínima de 30 minutos), cartão, webhook e assinatura `x-signature` (roteiro em `docs/PUBLICACAO.md`).
- Sem avisos de e-mail ou push para pedido, pagamento, resgate; sem estorno automático (o dono estorna no Mercado Pago); boleto fora do checkout.
- Rotação da chave de cifra dos segredos de integração (hoje derivada do `APP_SECRET`).

## Quando o app chegar

- Rotas `staff/*` dos módulos (pedidos, resgates).
- `POST /v1/store/orders` deve sempre mandar `Idempotency-Key` (sem ela, dois toques criam dois pedidos); nova cotação entre os toques dá 409 `idempotency_key_reused`.
- Logout não apaga o aparelho: o app chama `DELETE /v1/me/devices/{token}` antes de sair, ou o logout passa a aceitar `pushToken`.
- Esquemas de WebView (`capacitor://`, `ionic://`) nas origens do CORS.
- Tolerância à repetição da renovação por falha de rede; teto de vida da família de tokens.
- Troca de e-mail pelo app com verificação.
- Um app compartilhado × um app por negócio (a API atende os dois).
- `details.nearest` do erro de horário ocupado não traz `professionalIds`.
- `cancelReason` escrito pela equipe chega ao cliente: separar motivo público de interno.
- Recibos do Expo não são consultados.

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
