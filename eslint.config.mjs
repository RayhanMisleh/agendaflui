import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const metodosDeDataProibidos =
  '/^(getHours|getMinutes|getDay|getDate|getMonth|getFullYear|setHours|toLocaleString|toLocaleDateString|toLocaleTimeString)$/'

const regrasDeData = [
  'error',
  {
    selector: "NewExpression[callee.name='Date'][arguments.0.type='Literal'][arguments.0.value=/./]",
    message: 'Não crie Date a partir de texto. Use src/server/time/.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.0.type='TemplateLiteral']",
    message: 'Não crie Date a partir de texto. Use src/server/time/.',
  },
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='parse']",
    message: 'Não use Date.parse. Use src/server/time/.',
  },
  {
    selector: `MemberExpression[property.name=${metodosDeDataProibidos}]`,
    message: 'Não leia nem altere partes da data com o fuso do servidor. Use src/server/time/.',
  },
]

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
          patterns: [
            {
              group: ['@/server/db/client', '**/server/db/client'],
              message: 'O cliente Prisma cru só vale em src/server/db, auth, domain/platform, prisma, scripts e tests. Use tenantDb.',
            },
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
    files: [
      'src/server/db/**',
      'src/server/auth/**',
      'src/server/domain/platform/**',
      'prisma/**',
      'scripts/**',
      'tests/**',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
])
