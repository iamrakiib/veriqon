import { BadRequestException } from '@nestjs/common';
import { extractDocumentInProcess, UploadedDocument } from './document-parser';

process.once('message', (file: UploadedDocument) => {
  void extractDocumentInProcess(file).then(text => process.send?.({ text }), error => {
    process.send?.({ error: error instanceof BadRequestException ? error.message : 'This file could not be read safely.' });
  });
});
