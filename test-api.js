require('dotenv/config');
const axios = require('axios');

// Optional live smoke check: consumes provider quota and writes one document.
async function run() {
  if (!process.env.EVAL_EMAIL || !process.env.EVAL_PASSWORD) throw new Error('Set EVAL_EMAIL and EVAL_PASSWORD for a dedicated test account.');
  const client = axios.create({ baseURL: process.env.EVAL_API_ORIGIN || 'http://127.0.0.1:3000', timeout: 180000, headers: { 'X-Veriqon-Request': '1' } });
  const login = await client.post('/auth/login', { email: process.env.EVAL_EMAIL, password: process.env.EVAL_PASSWORD });
  client.defaults.headers.common.Cookie = (login.headers['set-cookie'] || []).map(value => value.split(';')[0]).join('; ');
  try {
    await client.post('/rag/add', { id: 'smoke-rag', source: 'smoke-rag.txt', text: 'RAG stands for Retrieval-Augmented Generation. It combines document retrieval with language model generation to ground answers in source evidence.' });
    const { data } = await client.post('/rag/query', { query: 'What is RAG?' });
    console.log(JSON.stringify({ status: data.status, draft: data.draft, factCheck: data.factCheck }, null, 2));
  } finally { await client.post('/auth/logout', {}); }
}
run().catch(error => { console.error(error.response?.data?.message || error.message); process.exitCode = 1; });
