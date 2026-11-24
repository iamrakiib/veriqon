import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/integration',workers:1,fullyParallel:false,timeout:180000,
  use:{baseURL:'http://127.0.0.1:3015',trace:'retain-on-failure',actionTimeout:15000},
  projects:[{name:'real-stack',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000},channel:process.env.PLAYWRIGHT_CHANNEL||undefined}}],
  webServer:[
    {command:'node scripts/test-lifecycle-server.mjs',url:'http://127.0.0.1:3016/rag/health',reuseExistingServer:false,timeout:90000},
    {command:'npm exec --workspace @veriqon/web -- next dev --hostname 127.0.0.1 --port 3015',url:'http://127.0.0.1:3015',reuseExistingServer:false,timeout:120000,env:{API_ORIGIN:'http://127.0.0.1:3016'}}
  ]
});
