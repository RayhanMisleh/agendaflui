# Tempo e fuso horário

Regras da seção 7 da spec, como estão implementadas. Todo o código de conversão fica em `src/server/time/index.ts`
(Temporal, via `temporal-polyfill`). Leia isto antes de mexer em agenda, relatórios ou métricas.

## Regras

1. O banco guarda **instantes** (`timestamptz`), nunca "os dígitos da hora local". A sessão do Postgres roda em UTC
   (`options -c timezone=UTC` em `src/server/db/connection.ts`; a partida em produção confere).
2. Cada conta tem seu fuso IANA (`businesses.timezone`; contas novas e o painel dev usam sempre `America/Sao_Paulo`, sem tela para trocar). O expediente é hora local da conta. Deslocamento fixo
   (`+03:00`) não vale: `isValidTimeZone` o recusa e `canonicalTimeZone` grava sempre a grafia canônica.
3. Toda conversão entre instante e hora local passa por `src/server/time/`. O ESLint proíbe fora dela `new Date(texto)`,
   `getHours`, `getDay`, `toLocale*`, `toISOString`, `getUTC*` e parecidos. O fuso do processo e o do navegador nunca entram na conta.
4. Quem consome (painel ou app) não faz conta de fuso. O servidor devolve cada horário livre como instante exato mais o
   rótulo local pronto (`SlotView`: `startsAt`, `label`); para marcar, o cliente devolve o mesmo instante.
5. Os painéis mostram sempre a hora da conta, mesmo com o navegador em outro fuso.
6. "Dia" em relatório, agenda e métricas é o dia de calendário no fuso da conta.

## Formatos que trafegam

- Instante: texto ISO 8601 em UTC (`2027-01-15T13:00:00.000Z`). Entra por `fromIsoInstant` (recusa datas que não existem)
  e sai por `toIsoInstant`. O Mercado Pago escreve com deslocamento: `fromIsoOffsetInstant`.
- Data local: `AAAA-MM-DD`. Hora local: `HH:mm`. Minuto do dia: inteiro de 0 a 1440 (`minuteLabel` e `parseMinuteLabel`
  convertem de e para `HH:mm`; 1440 é o fim do dia).
- Coluna `date` do Prisma vem à meia-noite UTC: `dbDateToLocal` e `localToDbDate` fazem a ponte.

## Funções principais

| Função | Para quê |
|---|---|
| `localDayRange`, `localMonthRange`, `localPeriods` | Início (inclusivo) e fim (exclusivo) do dia ou mês local, em instantes; `localPeriods` entrega hoje, mês até hoje, mês anterior e o mesmo trecho do mês anterior |
| `toInstant(data, hora, fuso)` | Data + hora locais em instante |
| `minuteToInstant`, `minuteToInstants` | Minuto do dia em um instante (regra `compatible`) ou em todos os instantes possíveis |
| `localParts`, `minuteOfDay`, `weekdayOf` | Instante em data, hora e dia da semana locais |
| `formatDate`, `formatTime`, `formatDateTime` | Texto para a tela no fuso da conta |
| `effectiveLocalTime` | O horário que de fato será gravado para uma data e hora (mostra o avanço no salto do verão) |
| `addDays`, `daysBetween`, `isoWeekRange`, `compareLocalDates` | Conta com datas locais, sem horário |

`ctx.clock()` é o relógio do domínio (nunca `new Date()`); nos testes ele é fixado.

## Horário de verão

- **Hora que não existe** (salto do início): `toInstant` e `minuteToInstant` seguem a regra `compatible` do Temporal e avançam
  (02:30 vira 03:30). `effectiveLocalTime` mostra isso na tela antes de gravar.
- **Hora repetida** (fim do verão): `toInstant` usa a primeira ocorrência.
- **Horários livres** (`computeSlots` em `domain/scheduling/slots.ts`): a grade é a do relógio local, mas cada minuto da grade vira
  todos os instantes em que o relógio o marca (`minuteToInstants`). No dia de 25 horas a hora repetida oferece as duas
  ocorrências; no de 23 horas a hora inexistente não oferece nada (nada fora da grade). Se o serviço cabe ou não é decidido
  pelo tempo real contra o início e o fim reais do expediente, então a duração conta em horas reais mesmo no dia de troca.
- Janelas de métricas e relatórios usam o início e o fim reais de cada ponta, então um dia de 23 ou 25 horas tem a duração certa.

## Testes

Obrigatórios: São Paulo, Manaus, Lisboa e Nova York (com horário de verão), viradas de dia, mês e ano, e a suíte com o processo
em fusos diferentes dando o mesmo resultado.

- `tests/unit/time.test.ts`, `time-extra.test.ts`, `time-periods.test.ts`, `slots.test.ts` (inclui Lisboa e Nova York nos dias de
  23 e 25 horas), `time-zone-canonical.test.ts` e `time-zone-choices.test.ts`.
- `npm run test:tz` roda os quatro primeiros com `TZ=UTC`, `TZ=Asia/Tokyo` e `TZ=America/Sao_Paulo`: o resultado tem de ser idêntico.
