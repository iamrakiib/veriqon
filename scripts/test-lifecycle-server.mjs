// Test-only HTTP fixture. Never imported by application code; no external inference.
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require=createRequire(import.meta.url);
require('reflect-metadata');
const { Pool }=require('pg');
for(const [key,port] of [['TEST_DATABASE_URL','55432'],['TEST_REDIS_URL','56379']]){
  const url=new URL(process.env[key]||'http://invalid');
  if(url.hostname!=='127.0.0.1'||url.port!==port)throw new Error('Provide explicit disposable local test endpoints.');
}
const schema='browser_'+randomUUID().replaceAll('-','');
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
await admin.query('CREATE EXTENSION IF NOT EXISTS vector');await admin.query(`CREATE SCHEMA ${schema}`);
const dbUrl=new URL(process.env.TEST_DATABASE_URL);dbUrl.searchParams.set('options',`-c search_path=${schema},public`);
const directory=mkdtempSync(join(tmpdir(),'veriqon-browser-'));
Object.assign(process.env,{NODE_ENV:'development',DATABASE_URL:dbUrl.toString(),REDIS_URL:process.env.TEST_REDIS_URL,REDIS_PREFIX:schema,
  JWT_SECRET:randomBytes(48).toString('hex'),SETUP_CODE:'browser-fixture-setup-only',ALLOW_REGISTRATION:'true',AUTH_COOKIE_SECURE:'false',
  APP_ORIGINS:'http://127.0.0.1:3015',DATABASE_PATH:join(directory,'unused.sqlite'),DOCUMENT_STORE_PATH:join(directory,'legacy.json'),SETUP_CODE_PATH:join(directory,'setup.txt'),
  OPENROUTER_API_KEY:'synthetic-fixture-only',OPENROUTER_BASE_URL:'http://127.0.0.1:9',EMBEDDING_MODEL:'fixture-embedding',LLM_MODEL:'fixture-chat',VERIFIER_MODEL:'fixture-chat',DECOMPOSER_MODEL:'fixture-chat',
  SEMANTIC_CACHE_ENABLED:'false',MAX_REPAIR_ATTEMPTS:'1',REVALIDATION_PER_HOUR:'100',REVALIDATION_ENABLED:'true',EMBEDDING_MIN_INTERVAL_MS:'0',VERIQON_PROCESS_ROLE:'integrated',JOB_QUEUE_MODE:'sql'});
const { NestFactory }=require('@nestjs/core'),{ValidationPipe}=require('@nestjs/common');
const { AppModule }=require('../dist/src/app.module');
const { VectorStoreService }=require('../dist/src/vector-store/vector-store.service');
const { RagService }=require('../dist/src/rag/rag.service');
const app=await NestFactory.create(AppModule,{logger:false});
app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
const store=app.get(VectorStoreService);store.getEmbedding=async()=>[1,0];store.getEmbeddings=async texts=>texts.map(()=>[1,0]);
const rag=app.get(RagService);
const oldFact='Engineering permits three remote days.',newFact='Engineering permits one remote day.',benefit='Benefits include twenty vacation days.';
rag.client={chat:{completions:{create:async body=>{
  const prompt=body.messages[0].content,input=JSON.parse(body.messages.at(-1).content);let content;
  if(prompt.startsWith('Decompose'))content=JSON.stringify({sentences:input.sentences.map(s=>{const text=s.text.replace(/\s*\[\d+\]/g,'').trim();return{id:s.id,kind:'FACTUAL',claims:[{text,span:text}]};})});
  else if(prompt.startsWith('Assess each')){
    const claims=input.facts.map(fact=>{const support=input.evidence.find(d=>d.text.includes(fact.text));const contrary=!support&&fact.text===oldFact?input.evidence.find(d=>d.text.includes(newFact)):undefined;
      return{id:fact.id,verdict:support?'SUPPORTED':contrary?'CONTRADICTED':'INSUFFICIENT_EVIDENCE',supporting:support?[{index:support.index,quote:fact.text}]:[],contradicting:contrary?[{index:contrary.index,quote:newFact}]:[],missingInformation:support||contrary?[]:['Exact requested fact'],temporalValidity:'APPLICABLE',scope:{time:null,place:'Engineering'}};});
    const left=input.evidence.find(d=>d.text.includes(oldFact)),right=input.evidence.find(d=>d.text.includes(newFact));
    const conflicts=left&&right?[{claim:oldFact,supporting:[{index:left.index,quote:oldFact}],contradicting:[{index:right.index,quote:newFact}],scope:{time:null,place:'Engineering'},scopeRelation:'SAME',periodRelation:'OVERLAPPING',precedence:'NONE_ESTABLISHED',reason:'Sources disagree with no recorded precedence.'}]:[];
    content=JSON.stringify({claims,conflicts});
  }else if(prompt.startsWith('Correct only'))content=JSON.stringify({corrections:input.assessment.filter(c=>c.verdict==='CONTRADICTED').map(c=>({claimId:c.id,replacement:input.question.includes('unsafe repair')?'Engineering permits one remote day and pays travel expenses.':newFact,evidence:c.contradicting}))});
  else content=oldFact+' [1] '+benefit+' [1]';
  return{model:'controlled-fixture',choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:100,completion_tokens:30}};
}}}};
await app.listen(3016,'127.0.0.1');
console.log('Disposable lifecycle API ready; real PostgreSQL, Redis, ingestion and revalidation timers; scripted inference.');
let closing=false;async function close(){if(closing)return;closing=true;await app.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
