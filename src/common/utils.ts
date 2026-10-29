export function cosineSim(a: number[], b: number[]) {
  if (!a || !b || a.length !== b.length) return 0;
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

export function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Simple character-based chunker with overlap. Suitable for short docs.
export function chunkText(text: string, chunkSize = 800, overlap = 120) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || !Number.isInteger(overlap) || overlap < 0 || overlap >= chunkSize) {
    throw new Error('CHUNK_SIZE must be positive and CHUNK_OVERLAP must be smaller than CHUNK_SIZE');
  }
  const chunks: string[] = [];
  if (!text || text.length === 0) return chunks;
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);
    // Prefer a paragraph/table-row boundary, without creating zero-progress windows.
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > start + Math.max(overlap, Math.floor(chunkSize * 0.6))) end = boundary;
    }
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) chunks.push(chunk);
    if (end >= text.length) break;
    start = end - overlap; // move back by overlap
    if (start < 0) start = 0;
  }
  return chunks;
}
