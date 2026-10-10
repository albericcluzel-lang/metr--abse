import { defineConfig, devices } from '@playwright/test';

// Port modifiable (PORT_E2E) pour lancer plusieurs séries de tests en parallèle.
const PORT = Number(process.env.PORT_E2E ?? 4321);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/metr--abse/`,
    trace: 'retain-on-failure',
    locale: 'fr-FR',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'pc', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } } },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/metr--abse/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
