import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const metodosDeDataProibidos =
  '/^(getHours|getMinutes|getDay|getDate|getMonth|getFullYear|setHours|toLocaleString|toLocaleDateString|toLocaleTimeString|toISOString|getTimezoneOffset|getUTC[A-Za-z]*)$/'

// `new Date(<arg>)` só passa com argumento claramente numérico: literal que começa com dígito,
// `Date.now()`, ou conta que não seja soma (`ms * 60`), ou soma que começa em `Date.now()` ou em literal
// numérico (`Date.now() + 1000`). Qualquer outra coisa (texto, variável, chamada, spread) é recusada:
// para um número vindo de variável, use `fromEpochMs(ms)` de src/server/time/.
const dataComArgumentoNaoNumerico =
  "NewExpression[callee.name='Date'][arguments.0]" +
  ":not([arguments.0.type='Literal'][arguments.0.raw=/^[0-9]/])" +
  ":not([arguments.0.type='CallExpression'][arguments.0.callee.object.name='Date'][arguments.0.callee.property.name='now'])" +
  ":not([arguments.0.type='BinaryExpression'][arguments.0.operator!='+'])" +
  ":not([arguments.0.type='BinaryExpression'][arguments.0.left.type='CallExpression'][arguments.0.left.callee.object.name='Date'][arguments.0.left.callee.property.name='now'])" +
  ":not([arguments.0.type='BinaryExpression'][arguments.0.left.type='Literal'][arguments.0.left.raw=/^[0-9]/])"

const regrasDeData = [
  'error',
  {
    selector: dataComArgumentoNaoNumerico,
    message: 'Não crie Date a partir de texto nem de variável. Use src/server/time/ (fromEpochMs para milissegundos).',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name=/^(parse|UTC)$/]",
    message: 'Não use Date.parse nem Date.UTC. Use src/server/time/.',
  },
  {
    selector: "MemberExpression[object.name='Intl'][property.name='DateTimeFormat']",
    message: 'Não use Intl.DateTimeFormat direto. Use src/server/time/.',
  },
  {
    selector: `MemberExpression[property.name=${metodosDeDataProibidos}]`,
    message: 'Não leia nem altere partes da data com o fuso do servidor. Use src/server/time/ (toIsoInstant para serializar).',
  },
  {
    selector: `MemberExpression[computed=true][property.value=${metodosDeDataProibidos}]`,
    message: 'Não leia nem altere partes da data com o fuso do servidor. Use src/server/time/.',
  },
  {
    selector: `ObjectPattern > Property[key.name=${metodosDeDataProibidos}]`,
    message: 'Não desestruture métodos de data. Use src/server/time/.',
  },
  {
    selector: `ObjectPattern > Property[key.value=${metodosDeDataProibidos}]`,
    message: 'Não desestruture métodos de data. Use src/server/time/.',
  },
  {
    selector: "VariableDeclarator[init.name='Date'] > ObjectPattern",
    message: 'Não desestruture métodos de Date. Use src/server/time/.',
  },
]

const semPrismaCru = {
  group: ['@/server/db/client', '**/db/client', '**/db/client.*', '**/server/db/client', '**/server/db/client.*'],
  message: 'O cliente Prisma cru só vale em src/server/db, auth, domain/platform, prisma, scripts e tests. Use tenantDb.',
}

const semSegredos = {
  group: ['**/integration-secrets', '**/integration-secrets.*'],
  message: 'O leitor de segredos de integração só vale em src/server/domain/store (o teste tests/unit/integration-secrets-imports.test.ts confere o mesmo).',
}

const semInterface = {
  group: ['@/ui', '@/ui/**', '**/ui/**'],
  message: 'O servidor não importa da interface. O que for comum fica em src/shared.',
}

const semServidorNemInterface = {
  group: ['@/server', '@/server/**', '**/server/**', '@/ui', '@/ui/**', '**/ui/**'],
  message: 'src/shared é neutro: não importa de src/server nem de src/ui.',
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '_legacy/**',
    '.local/**',
    // Cópias de trabalho (git worktree) de outras sessões: têm o próprio lint.
    '.claude/**',
    'src/server/db/generated/**',
    'test-results/**',
    'playwright-report/**',
  ]),
  {
    rules: {
      'no-restricted-syntax': regrasDeData,
      'no-restricted-imports': [
        'error',
        {
          patterns: [semPrismaCru, semSegredos],
        },
      ],
    },
  },
  {
    files: ['src/server/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [semPrismaCru, semSegredos, semInterface] }] },
  },
  {
    files: ['src/shared/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            semPrismaCru,
            semSegredos,
            semServidorNemInterface,
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/time/**', 'tests/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Pastas liberadas para o cliente Prisma cru; ainda assim, o servidor não importa da interface.
    files: ['src/server/db/**', 'src/server/auth/**', 'src/server/domain/platform/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [semSegredos, semInterface] }] },
  },
  {
    // O envio de avisos atravessa contas por desenho: usa o Prisma cru e filtra por `businessId` a cada consulta de conta.
    files: ['src/server/notifications/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [semSegredos, semInterface] }] },
  },
  {
    // O domínio da loja é o único que lê segredos de integração em texto; vale o resto das regras de `src/server`.
    files: ['src/server/domain/store/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [semPrismaCru, semInterface] }] },
  },
  {
    files: ['prisma/**', 'scripts/**', 'tests/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
])
