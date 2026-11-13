import { defineConfig } from '@playwright/test'

// Os testes leem as credenciais de demonstração do .env (sem .env, valem as variáveis do ambiente).
try {
  process.loadEnvFile()
} catch {
  // Sem .env.
}

// O navegador resolve *.localhost sozinho; a prontidão do servidor usa só a porta
// (o Node pode não resolver dev.localhost no macOS). O host vem de DEV_HOST, como em src/proxy.ts.
const devHost = process.env.DEV_HOST || 'dev.localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://${devHost}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 3000,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
