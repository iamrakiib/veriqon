import 'dotenv/config';
import axios from 'axios';

async function run() {
  if (!process.env.EVAL_EMAIL || !process.env.EVAL_PASSWORD) throw new Error('Set EVAL_EMAIL and EVAL_PASSWORD for an account with indexed research documents.');
  const client = axios.create({ baseURL: process.env.EVAL_API_ORIGIN || 'http://127.0.0.1:3000', headers: { 'X-Veriqon-Request': '1' }, timeout: 180000 });
  const session = await client.post('/auth/login', { email: process.env.EVAL_EMAIL, password: process.env.EVAL_PASSWORD });
  client.defaults.headers.common.Cookie = (session.headers['set-cookie'] || []).map((value: string) => value.split(';')[0]).join('; ');
  const queries = [
    'What is RAG?',
    'Why is RAG useful in research?',
    'How does RAG combine retrieval and generation?',
    'Explain the role of fact-checking in RAG.',
    'Define Retrieval-Augmented Generation.',
    'Benefits of grounding answers in documents?',
    'When does RAG fail to answer?',
    'How to reduce hallucinations in LLMs?',
    'What is semantic retrieval?',
    'Why use embeddings?',
    'What is cosine similarity?',
    'How are documents chunked?',
    'What metadata helps citations?',
    'How to persist a vector store?',
    'Compare RAG to QA.',
    'Limitations of RAG?',
    'Evaluate confidence scoring.',
    'Best models for RAG?',
    'Free LLM options?',
    'OpenRouter usage?'
  ];

  let afterFailures = 0;

  for (const q of queries) {
    const res = await client.post('/rag/query', { query: q });
    const { draft, factCheck, status } = res.data;
    const failed = status === 'abstained';
    console.log(`Q: ${q}\nStatus: ${status}\nVerdict: ${factCheck.verdict}\nDraft: ${draft.slice(0,120)}...\n`);
    if (failed) afterFailures++; // after regeneration loop applied in service
  }

  console.log(`\nAbstentions: ${afterFailures}/${queries.length}. This smoke test does not measure factual accuracy.`);
}

run().catch(err => {
  console.error(err.message);
  process.exit(1);
});
