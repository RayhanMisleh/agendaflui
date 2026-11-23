# Redesenho do painel pela marca Agenda Flui — direção de design

Fonte da verdade: `../branding/AgendaFlui-Marca/` (manual em PDF, `design-tokens/agenda-flui-tokens.json`, `logos/`, `fontes/`) e a landing em `../site/` (`app/globals.css`, `components/*`). O painel deixa o estilo de papel, couro e carimbo e passa a falar a língua da marca. Nada de marca nova: é a identidade que já existe, levada às telas de trabalho.

## A ideia em uma frase

A agenda que flui: água para agir, caramelo para o horário marcado, tinta para ler; superfícies limpas, cantos do símbolo, e bolhas só onde há algo a comemorar ou a preencher.

## Cores (tokens da marca; a conta troca Água e Caramelo pelas cores dela)

| Papel | Claro | Noite | Uso |
|---|---|---|---|
| brand (Água) | `#0B6E66` | `#3CC4B4` | ação: botão principal, link, item ativo, blocos da agenda |
| brand-strong | `#08534D` | `#6EDBCD` | hover e pressionado |
| brand-tint (Bolha) | `#D7EFEB` | `#12403B` | horário livre, selecionado, destaque suave |
| on-brand | `#FFFFFF` | `#062421` | texto sobre brand |
| accent (Caramelo) | `#F2A93B` | `#F5B85A` | o horário marcado, o que pede carinho ou atenção; nunca cor de texto |
| accent-tint (Mel) | `#FCEBD0` | `#4A3514` | avisos amigáveis, lembretes |
| ground (Espuma) | `#F3F8F6` | `#0C1A18` | fundo de página |
| surface | `#FFFFFF` | `#13241F` | cartões, painéis, folhas |
| ink (Tinta) | `#0F2A27` | `#E8F2EF` | texto |
| ink-muted | `#4A615D` | `#9DB3AE` | texto secundário |
| line | `#D3E2DE` | `#24403A` | bordas e grade |
| success / danger | `#1E8A4C` / `#C8412F` | `#4CC47E` / `#F07A68` | só estado |

Proporção numa tela: 70% espuma e branco, 20% tinta, 8% água, 2% caramelo. O caramelo é raro de propósito: aparece no ponto do logo, no próximo atendimento, no anel de foco e no que precisa de atenção.

## Tipografia

Bricolage Grotesque 700 para títulos e para números grandes (contadores, horários em destaque); Figtree 400/600/700 para texto e interface. Escala da marca: 64 / 44 / 32 / 22 / 19 / 16 / 14. Títulos com `letter-spacing` negativo (−0,03em a −0,015em) e `text-wrap: balance`. Horários sempre com `font-variant-numeric: tabular-nums`. Frases em caixa normal; nada de rótulos em maiúsculas.

## Forma

- Cantos: 10 px em campos e chips de horário, 16 px em cartões, 28 px em blocos de destaque, pílula em botões e selos.
- Cartão = superfície branca com borda fina `line`, sem sombra. Só o que flutua (folha, diálogo, menu, aviso) tem a sombra `0 24px 48px -20px rgba(15,42,39,.45)`.
- Foco de teclado: contorno de 3 px em caramelo, afastado 2 px (igual ao site).
- Bolhas: círculos em Bolha ou Caramelo, poucos, como grafismo de blocos de destaque, telas de entrada e estados vazios. Nunca atrás de texto corrido.
- Ícones de traço arredondado 2 px (Lucide), em tinta ou água.
- Movimento só em resposta a ação (abrir, confirmar, arrastar); respeita `prefers-reduced-motion`.

## Os dois painéis

**Painel do negócio — dia claro.** Fundo espuma; barra lateral com a marca da conta; conteúdo em cartões brancos. A peça de destaque é a agenda: grade do dia como a `DayAgenda` do site — blocos cheios na cor da conta com o nome do cliente em negrito, bloco caramelo para o que pede atenção, vaga livre com borda tracejada, linha do "agora". O Início abre com um bloco de 28 px na cor da conta ("Hoje"), com bolhas e o próximo atendimento num cartão branco por cima, como o card de agendamento do hero do site.

**Painel dev — noite.** Mesmos componentes no tema noite da marca (fundo `#0C1A18`, cartões `#13241F`, linhas `#24403A`, água clara `#3CC4B4`): é a seção escura do site virada painel. Números em Bricolage, situação por ponto colorido com texto.

**Entrada.** Bloco de 28 px na cor da conta (ou água, na entrada genérica) com bolhas e o logo; o formulário num cartão branco que flutua (única sombra da tela).

**Celular (375 px).** Navegação em barra na base, em pílula; tabelas viram cartões; formulários sobem como folha.

## Personalização por conta (sem mudar o banco)

A conta escolhe cor principal, cor de destaque, barra lateral, logo, símbolo, favicon e imagem de entrada. Fundo (Espuma) e fontes (Bricolage Grotesque e Figtree) são os da marca em toda conta. Os campos antigos ganham sentido novo, com os mesmos valores gravados:

| Campo | Antes | Agora (rótulo na tela) |
|---|---|---|
| `primary` | cor da capa | cor da conta (no lugar de Água): dela saem `brand-strong`, `brand-tint` e `on-brand`, com contraste AA garantido |
| `accent` | destaque | cor de destaque (no lugar de Caramelo), e dela o tom claro (Mel) |
| `material` | couro, linho, madeira, esmalte | "Barra lateral": `LEATHER` Cheia (cor da conta, logo em negativo) · `LINEN` Suave (Bolha da conta) · `WOOD` Noite (tinta) · `ENAMEL` Clara (branca) |

A marca Agenda Flui (painel dev, entrada genérica, e-mails da plataforma, padrão de conta nova) usa Água e Caramelo, barra Cheia, fundo Espuma e o par da marca.

## O que muda de nome

O vocabulário de papelaria sai do código: `Paper` → `Card`, `Stamp` → `StatusBadge`, `Lamp` → `StatusDot`, `Counter` → `StatNumber`, `Gauge` → `Meter`, "capa" → "barra lateral", `materials.css` sai. As classes `af-*` acompanham.

## Voz

Português do Brasil, frases curtas, verbo na frente, "você". Botão diz a ação e a confirmação repete o verbo ("Agendar banho" → "Banho agendado"). Use o nome do cliente (e do pet, quando houver) sempre que der. Sem jargão (dashboard, SaaS) e sem diminutivo em tudo.

## Fora deste trabalho

Modo escuro do painel do negócio (os tokens existem; fica para depois), fotos de marca, e o aplicativo (repositório próprio, mesma marca).
