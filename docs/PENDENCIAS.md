# Pendências

Só o que está aberto hoje. Tirar daqui o que for resolvido.

## Externas e decisões

- Google: verificação da marca em andamento. O escopo `calendar.events` segue não verificado por decisão do dono (aviso de
  app não verificado ao ligar a agenda, limite de 100 usuários). Ver `docs/PUBLICACAO.md`.
- App nativo (repositório irmão `app/`): parado. Não funciona com este backend, que não tem mais rotas para ele.
- Páginas `/privacidade` e `/termos` não existem no app (os nomes estão reservados).

## Antes de abrir a Loja para uma conta real

- Mercado Pago, Frenet e ViaCEP reais nunca foram chamados (só as versões falsas). Rodar o teste no sandbox de
  `docs/PUBLICACAO.md` (Pix, cartão, webhook com `x-signature`).
- Sem avisos por e-mail de pedido, pagamento e resgate; sem estorno automático; boleto fora do checkout.
- Sem rotação da chave de cifra dos segredos de integração (derivada do `APP_SECRET`).

## Conferir no navegador (nenhum agente abre navegador; só há testes e `npm run smoke`)

- Telas a 360–375 px, foco nos diálogos, movimento reduzido, cor de loja muito clara.
- Agenda: arrastar a ficha (mouse, teclado, folha), confirmação de conflito e encaixe na grade.
- Cadastro pela loja até o quiz do pet; agendar, remarcar, cancelar fora do prazo; `.ics` no celular.
- Loja até o Mercado Pago de teste; excluir a conta na loja (com senha e só com Google).
- `/painel/comecar` completo; envio de logo, foto da equipe e imagens; CSV de relatórios.

## Produto (decisões a revisar)

- O sucesso do agendamento não mostra os pontos a ganhar.
- O quiz guarda "Sem raça definida" como texto em `breed`.
- Enviar a logo no passo Marca do começo recarrega a página e perde cores não salvas.

## Técnicas

- Segurança: CSP completa com nonce (hoje só `frame-ancestors`) e cookies com prefixo `__Host-`.
- Medir com tráfego real: limite geral por IP, tamanho do pool, espera da trava por profissional (até 15 s).
- PgBouncer em modo transação pode ignorar `-c timezone=UTC` (a partida confere e recusa).
- Telefone estrangeiro sem `+` com 10 ou 11 dígitos é tratado como brasileiro.
- Relatórios: `byDay` agrega dia a dia (até 366 consultas); `orders` sem índice em `paid_at`.
- `isUniqueViolation` olha só o código `P2002`, sem conferir qual índice.
- `labelOfMinute` (`ui/components/planner/drag-math.ts`) repete `minuteLabel` do servidor.
- `scripts/dev.ts` registra `SIGINT`/`SIGTERM` só depois de subir banco e Next: Ctrl+C na partida deixa o banco ligado.
- Agenda no celular com uma coluna: seta do teclado pode mover a prévia para coluna oculta (`use-drag-reschedule.ts`).
- `Tabs` com `href` sem `aria-current`; `Dialog` intercepta Esc de filhos.
- Falha de disco na rota `/arquivos` vira 404 sem registro.

## Desenvolvimento local

- O banco embutido (`.local/pg`) pode ficar com uma migração marcada como falha. Se acontecer, `npm run db:reset` e
  `npm run dev` de novo.
