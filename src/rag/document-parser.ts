import { BadRequestException, HttpException } from '@nestjs/common';
import { extname, join } from 'path';
import { fork } from 'node:child_process';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 100000;
export type UploadedDocument = { originalname: string; buffer: Buffer; size: number };

let parsing = false;
export async function extractDocument(file?: UploadedDocument): Promise<string> {
  if (process.env.NODE_ENV !== 'production' && process.env.PARSER_ISOLATION !== 'process') return extractDocumentInProcess(file);
  if (!file?.buffer?.length) throw new BadRequestException('Choose a non-empty PDF, DOCX, TXT or Markdown file.');
  if (file.buffer.length > MAX_FILE_BYTES || file.size > MAX_FILE_BYTES) throw new BadRequestException('Files must be 10 MB or smaller.');
  if (parsing) throw new HttpException('Another file is being read. Please retry shortly.', 429);
  parsing = true;
  try {
    return await new Promise<string>((resolve, reject) => {
      // Separate heap and deadline. Provider/database credentials are not inherited.
      const child = fork(join(__dirname, 'parser-worker.js'), [], { serialization: 'advanced',
        execArgv: ['--max-old-space-size=96'], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP } });
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new BadRequestException('This file took too long to read. Split or simplify it before uploading.')); }, 20000);
      const cleanup = () => { clearTimeout(timer); child.kill('SIGKILL'); };
      child.once('message', (message: { text?: unknown; error?: unknown }) => {
        cleanup();
        if (typeof message.text === 'string' && message.text.length <= MAX_TEXT_LENGTH) resolve(message.text);
        else reject(new BadRequestException(typeof message.error === 'string' ? message.error : 'This file could not be read safely.'));
      });
      child.once('error', () => { cleanup(); reject(new BadRequestException('The document reader could not start. Please retry.')); });
      child.once('exit', () => { clearTimeout(timer); reject(new BadRequestException('This file exceeded the document reader limits or could not be read. Try a smaller file.')); });
      child.send(file, error => { if (error) { cleanup(); reject(new BadRequestException('The document reader could not receive this file.')); } });
    });
  } finally { parsing = false; }
}

export async function extractDocumentInProcess(file?: UploadedDocument): Promise<string> {
  if (!file?.buffer?.length) throw new BadRequestException('Choose a non-empty PDF, DOCX, TXT or Markdown file.');
  if (file.size > MAX_FILE_BYTES || file.buffer.length > MAX_FILE_BYTES) throw new BadRequestException('Files must be 10 MB or smaller.');
  if (file.originalname.length > 255) throw new BadRequestException('Use a filename shorter than 256 characters.');
  const extension = extname(file.originalname).toLowerCase();
  let text: string;
  try {
    if (extension === '.pdf') {
      const { PDFParse } = await import('pdf-parse');
      if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Invalid PDF');
      const parser = new PDFParse({ data: file.buffer });
      try { text = (await parser.getText()).pages.map(page => page.text).join('\n\n'); } finally { await parser.destroy(); }
    } else if (extension === '.docx') {
      const { extractRawText } = await import('mammoth');
      text = (await extractRawText({ buffer: file.buffer })).value;
    } else if (extension === '.txt' || extension === '.md') {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer);
    } else {
      throw new BadRequestException('Supported formats: PDF, DOCX, TXT and Markdown. Convert legacy .doc files to .docx.');
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('This file could not be read. Use a valid, unencrypted PDF/DOCX or UTF-8 text file.');
  }
  text = text.trim();
  if (!text || text.includes('\0')) throw new BadRequestException('No readable text was found. Scanned PDFs need OCR before upload.');
  if (text.length > MAX_TEXT_LENGTH) throw new BadRequestException('This document exceeds 100,000 extracted characters. Split it into smaller documents.');
  return text;
}
