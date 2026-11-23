// Acceptance-only HTTP model fixture. Never imported or enabled by production Compose.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
const oldFact = 'Engineering permits three remote days.', newFact = 'Engineering permits one remote day.';
const benefit = 'Benefits include twenty vacation days.';
let embeddings = 0, calls = 0, hold = false, holdAfter = 2;
const inputsSeen = {};
createServer(async (request, response) => {
  try {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/control') { hold = Boolean(body.hold); holdAfter = embeddings + 2; response.end('{}'); return; }
    if (request.url === '/stats') { response.end(JSON.stringify({ embeddings, calls, hold, inputsSeen })); return; }
    if (body.model === 'missing-fixture-model') { response.writeHead(404); response.end('{"error":{"message":"Model unavailable"}}'); return; }
    if (request.url.endsWith('/embeddings')) {
      if (hold && embeddings >= holdAfter) return; // Controlled interruption after saved batches.
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      embeddings += inputs.length;
      for (const input of inputs) { const hash = createHash('sha256').update(input).digest('hex'); inputsSeen[hash] = (inputsSeen[hash] || 0) + 1; }
      response.end(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [1, 0] })), usage: { total_tokens: 1 } })); return;
    }
    if (!request.url.endsWith('/chat/completions')) { response.writeHead(404); response.end('{}'); return; }
    calls++;
    const prompt = body.messages[0].content, input = JSON.parse(body.messages.at(-1).content); let content;
    if (prompt.startsWith('Decompose')) content = JSON.stringify({ sentences: input.sentences.map(s => {
      const text = s.text.replace(/\s*\[\d+\]/g, '').trim(); return { id: s.id, kind: 'FACTUAL', claims: [{ text, span: text }] };
    }) });
    else if (prompt.startsWith('Assess each')) {
      const claims = input.facts.map(fact => {
        const support = input.evidence.find(d => d.text.includes(fact.text));
        const contrary = !support && fact.text === oldFact ? input.evidence.find(d => d.text.includes(newFact)) : undefined;
        return { id: fact.id, verdict: support ? 'SUPPORTED' : contrary ? 'CONTRADICTED' : 'INSUFFICIENT_EVIDENCE',
          supporting: support ? [{ index: support.index, quote: fact.text }] : [],
          contradicting: contrary ? [{ index: contrary.index, quote: newFact }] : [], missingInformation: support || contrary ? [] : ['Exact requested fact'],
          temporalValidity: 'APPLICABLE', scope: { time: null, place: 'Engineering' } };
      });
      const left = input.evidence.find(d => d.text.includes(oldFact)), right = input.evidence.find(d => d.text.includes(newFact));
      const conflicts = left && right ? [{ claim: oldFact, supporting: [{ index: left.index, quote: oldFact }], contradicting: [{ index: right.index, quote: newFact }],
        scope: { time: null, place: 'Engineering' }, scopeRelation: 'SAME', periodRelation: 'OVERLAPPING', precedence: 'NONE_ESTABLISHED', reason: 'Sources disagree without precedence.' }] : [];
      content = JSON.stringify({ claims, conflicts });
    } else if (prompt.startsWith('Correct only')) content = JSON.stringify({ corrections: input.assessment.filter(c => c.verdict === 'CONTRADICTED').map(c => ({ claimId: c.id, replacement: newFact, evidence: c.contradicting })) });
    else content = oldFact + ' [1] ' + benefit + ' [1]';
    response.end(JSON.stringify({ model: 'controlled-fixture', choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 30 } }));
  } catch { response.writeHead(500); response.end('{"error":{"message":"Invalid fixture input"}}'); }
}).listen(8080, '0.0.0.0');
