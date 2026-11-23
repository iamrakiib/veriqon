import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const project = process.argv[2];
if (!/^veriqon-m5(?:-[a-z]+)?$/.test(project)) throw new Error('Use a disposable veriqon-m5 acceptance project.');
const prefix = ['compose', '-p', project, '--env-file', '.env.docker', '-f', 'compose.yaml', '-f', 'compose.acceptance.yaml'];
function run(args, success, label) {
  const started = Date.now();
  const result = spawnSync('docker', [...prefix, ...args], { encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined, label + ' must exit within 60 seconds');
  assert.equal(result.status === 0, success, label);
  console.log(JSON.stringify({ label, passed: true, exitCode: result.status, ms: Date.now() - started }));
}
run(['run', '--rm', '--no-deps', '-e', 'DATABASE_URL=postgresql://veriqon:wrong-test-password@postgres:5432/veriqon', 'api'], false, 'Wrong database password fails startup');
run(['run', '--rm', '--no-deps', '-e', 'REDIS_URL=redis://127.0.0.1:1', 'api'], false, 'Unavailable admission Redis fails startup');
run(['run', '--rm', '--no-deps', '-e', 'QUEUE_REDIS_URL=redis://127.0.0.1:1', 'worker'], false, 'Unavailable queue Redis fails worker startup');
run(['run', '--rm', '--no-deps', '-e', 'OPENROUTER_API_KEY=', 'api', 'node', '-e',
  "require('reflect-metadata'); const assert=require('node:assert/strict'); const {VectorStoreService}=require('./dist/src/vector-store/vector-store.service');new VectorStoreService({}).getEmbedding('fixture').then(()=>process.exit(2)).catch(e=>{assert.match(e.message,/OPENROUTER_API_KEY/);console.log('Actionable missing key error')})"], true, 'Missing provider key rejected before embedding request');
run(['run', '--rm', '--no-deps', '-e', 'WORKER_HEARTBEAT_PATH=/tmp/absent-test-heartbeat.json', 'worker', 'node', 'dist/scripts/worker-health.js'], false, 'Absent worker heartbeat fails health check');
run(['run', '--rm', '--no-deps', '-e', 'EMBEDDING_MODEL=missing-fixture-model', 'api', 'node', '-e',
  "require('reflect-metadata'); const assert=require('node:assert/strict'); const {NestFactory}=require('@nestjs/core'); const {AppModule}=require('./dist/src/app.module'); const {VectorStoreService}=require('./dist/src/vector-store/vector-store.service'); (async()=>{const app=await NestFactory.createApplicationContext(AppModule,{logger:false});try{await assert.rejects(app.get(VectorStoreService).getEmbedding('fixture'),/configured model or request is unavailable/)}finally{await app.close()}})().catch(()=>process.exitCode=1)"], true, 'Unavailable model produces actionable configuration error');
