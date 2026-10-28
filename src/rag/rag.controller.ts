import { Controller, Post, Body, Get, Delete, BadRequestException, HttpCode, HttpStatus, UseInterceptors, UploadedFile, Param, Res, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, Public } from '../auth/auth.guard';
import { Account } from '../auth/auth.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash, randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../common/redis.service';
import { WorkLimiter } from '../common/work-limiter';
import { providerError } from '../common/provider';
import { extractDocument, MAX_FILE_BYTES, UploadedDocument } from './document-parser';
import { RagService } from './rag.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsInt, IsUUID, Min, MaxLength, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  query!: string;
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsUUID() messageId?: string;
}

export class AddDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  version?: string;
}

export class BulkAddDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AddDocumentDto)
  documents!: AddDocumentDto[];
}

@Controller('rag')
export class RagController {
  private readonly work = new WorkLimiter();
  private execute<T>(owner: string, task: () => Promise<T>) { return (this.redis?.enabled ? this.redis : this.work).run(owner, async () => { if (this.redis?.enabled) await this.redis.limit(`work:${owner}`, 20, 60000, 'You have reached 20 operations per minute. Wait one minute and retry.'); else await this.database.limitWork(owner); return task(); }); }
  constructor(private readonly rag: RagService, private readonly store: VectorStoreService, private readonly database: DatabaseService, @Optional() private readonly redis?: RedisService) {}

  @Get('health')
  @Public()
  health() {
    return { status: 'ok', providerConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()), storage: this.database.dialect, capabilities: { authentication: true, temporal: false, conflicts: false, persistedAnswers: true } };
  }

  @Get('ready')
  @Public()
  async ready() {
    try { await this.database.ping(); await this.redis?.ping(); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException('Storage or request coordination is unavailable.'); }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0 } }))
  async upload(@CurrentUser() user: Account, @UploadedFile() file?: UploadedDocument) {
    return this.execute(user.id, async () => {
    const text = await extractDocument(file);
    const source = file!.originalname;
    const id = createHash('sha256').update(source).update('\0').update(text).digest('hex');
    const mime = source.toLowerCase().endsWith('.pdf') ? 'application/pdf' : source.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain; charset=utf-8';
    await this.store.addDocument(id, text, { source }, user.id, { bytes: file!.buffer, name: source, mime });
    return { success: true, id };
    });
  }

  @Post('query')
  @HttpCode(HttpStatus.OK)
  async query(@Body() dto: QueryDto, @CurrentUser() user: Account) {
    if (!dto.query || dto.query.trim().length === 0) {
      throw new BadRequestException('Query cannot be empty');
    }
    const conversationId = dto.conversationId || dto.messageId || randomUUID();
    const messageId = dto.messageId || randomUUID();
    const previous = await this.database.previousMessage(user.id, messageId, conversationId, dto.query);
    if (previous) return { ...previous, conversationId, messageId };
    return this.execute(user.id, async () => {
      await this.database.beginMessage(user.id, conversationId, dto.query, messageId);
      try {
        const result = await this.rag.queryPipeline(dto.query, user.id);
        await this.database.finishMessage(user.id, messageId, result);
        return { ...result, conversationId, messageId };
      } catch (error) {
        const failure = providerError(error, 'Answer failed');
        await this.database.finishMessage(user.id, messageId, undefined, failure.message);
        throw failure;
      }
    });
  }

  @Get('conversations')
  conversations(@CurrentUser() user: Account) { return this.database.conversations(user.id); }

  @Post('add')
  @HttpCode(HttpStatus.CREATED)
  async add(@Body() dto: AddDocumentDto, @CurrentUser() user: Account) {
    if (!dto.id?.trim() || !dto.text?.trim()) {
      throw new BadRequestException('Both id and text are required');
    }
    await this.execute(user.id, () => this.store.addDocument(dto.id, dto.text, { source: dto.source, page: dto.page, version: dto.version }, user.id));
    return { success: true, id: dto.id };
  }

  @Post('bulk-add')
  @HttpCode(HttpStatus.CREATED)
  async bulkAdd(@Body() dto: BulkAddDto, @CurrentUser() user: Account) {
    if (!dto.documents || dto.documents.length === 0) {
      throw new BadRequestException('Documents array cannot be empty');
    }
    return this.execute(user.id, () => this.store.bulkAdd(dto.documents, user.id));
  }

  @Get('docs')
  async docs(@CurrentUser() user: Account) {
    return this.store.getAllDocs(user.id);
  }

  @Delete('docs/:id')
  async remove(@Param('id') id: string, @CurrentUser() user: Account) { await this.database.deleteDocument(user.id, id); return { success: true }; }

  @Get('docs/:id/file')
  async download(@Param('id') id: string, @CurrentUser() user: Account, @Res() response: Response) {
    const file = await this.store.getOriginal(user.id, id);
    response.setHeader('Content-Type', file.mime);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.bytes);
  }
}
