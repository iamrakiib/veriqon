import { Controller, Post, Put, Body, Get, Delete, BadRequestException, ConflictException, NotFoundException, HttpCode, HttpStatus, UseInterceptors, UploadedFile, Param, Query, Res, Optional, ServiceUnavailableException } from '@nestjs/common';
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
import { UploadAdmissionInterceptor } from './upload-admission.interceptor';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsInt, IsUUID, Min, Max, MaxLength, Length, Matches, IsIn, IsDefined, ArrayMinSize, ArrayMaxSize, NotContains } from 'class-validator';
import { Type } from 'class-transformer';
import { IngestionService } from './ingestion.service';
import { SYNC_DOCUMENT_CHARACTERS } from '../common/ingestion-config';
import { RevalidationService } from './revalidation.service';
import { sqlPollingEnabled } from '../common/background-config';
import type { SourceMetadata } from './temporal';
import type { ConflictDecision } from '../database/knowledge-store';

class SourceMetadataDto implements SourceMetadata {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) publishedAt?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveTo?: string;
  @IsOptional() @IsString() @MaxLength(160) @NotContains('\0') scope?: string;
  @IsOptional() @IsString() @MaxLength(160) @NotContains('\0') authority?: string;
  @IsOptional() @IsString() @MaxLength(160) @NotContains('\0') supersedes?: string;
}
class UpdateMetadataDto {
  @IsDefined() @ValidateNested() @Type(() => SourceMetadataDto) metadata!: SourceMetadataDto;
  @IsInt() @Min(0) @Max(2147483647) expectedRevision!: number;
  @IsString() @Length(10, 1000) @NotContains('\0') reason!: string;
}
class ConflictDecisionDto implements ConflictDecision {
  @IsIn(['PREFER_SOURCE','DIFFERENT_SCOPE','KEEP_UNRESOLVED']) action!: ConflictDecision['action'];
  @IsOptional() @IsString() @MaxLength(160) @NotContains('\0') preferredDocumentId?: string;
  @IsString() @Length(10, 1000) @NotContains('\0') explanation!: string;
  @IsInt() @Min(0) @Max(2147483647) expectedRevision!: number;
}
class ConflictHistoryItemDto {
  @IsString() @Length(1, 160) @NotContains('\0') id!: string;
  @IsInt() @Min(0) @Max(2147483647) expectedRevision!: number;
}
class ClearConflictHistoryDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ConflictHistoryItemDto) records!: ConflictHistoryItemDto[];
}

export class QueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  @NotContains('\0')
  query!: string;
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsUUID() messageId?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf?: string;
}

export class HistoryQueryDto {
  @IsOptional() @IsString() @MaxLength(300) before?: string;
}
export class LifecycleHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() @MaxLength(300) cursor?: string;
}

export class AddDocumentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @NotContains('\0')
  id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100000)
  @NotContains('\0')
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @NotContains('\0')
  source?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  page?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @NotContains('\0')
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
  constructor(private readonly rag: RagService, private readonly store: VectorStoreService, private readonly database: DatabaseService, @Optional() private readonly redis?: RedisService, @Optional() private readonly ingestion?: IngestionService, @Optional() private readonly revalidation?: RevalidationService) {}

  @Get('health')
  @Public()
  health() {
    // Capabilities describe implemented local workflows, not provider accuracy or cloud readiness.
    return {
      status: 'ok', providerConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()), storage: this.database.dialect,
      capabilities: { authentication: true, temporal: true, conflicts: true, conflictDecisions: true, conflictLibraryScan: false, persistedAnswers: true, answerVersions: true, revalidation: Boolean(this.revalidation), durableUploads: Boolean(this.ingestion) },
      implementation: {
        temporal: { status: 'implemented', effectiveDateFiltering: true, archivedVersionRetrieval: true },
        conflictDecisions: { status: 'implemented', persistedDecisions: true, deterministicApplication: true, uiIntegrated: true },
        answerVersions: { status: 'implemented', persistedVersions: true, uiIntegrated: true },
        revalidation: { status: 'implemented', schedulerEnabled: sqlPollingEnabled() && Boolean(this.revalidation) && process.env.NODE_ENV !== 'test' && process.env.REVALIDATION_ENABLED !== 'false',
          separateWorker: process.env.JOB_QUEUE_MODE === 'bullmq', processRole: process.env.VERIQON_PROCESS_ROLE || 'integrated',
          transport: process.env.JOB_QUEUE_MODE || 'sql', endToEndVerified: false, localControlledWorkflowVerified: true, liveProviderVerified: false }
      }
    };
  }

  @Get('ready')
  @Public()
  async ready() {
    try { await this.database.ping(); await this.redis?.ping(); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException('Storage or request coordination is unavailable.'); }
  }

  @Post('upload')
  @UseInterceptors(UploadAdmissionInterceptor, FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2, headerPairs: 50 } }))
  async upload(@CurrentUser() user: Account, @UploadedFile() file?: UploadedDocument) {
    return this.execute(user.id, async () => {
    const text = await extractDocument(file);
    if (text.length > SYNC_DOCUMENT_CHARACTERS) throw new BadRequestException('Use the background upload queue for documents over 100,000 characters.');
    const source = file!.originalname;
    const id = createHash('sha256').update(source).update('\0').update(text).digest('hex');
    const mime = source.toLowerCase().endsWith('.pdf') ? 'application/pdf' : source.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain; charset=utf-8';
    await this.store.addDocument(id, text, { source }, user.id, { bytes: file!.buffer, name: source, mime });
    return { success: true, id };
    });
  }

  @Post('uploads')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(UploadAdmissionInterceptor, FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 2, headerPairs: 50 } }))
  queuedUpload(@CurrentUser() user: Account, @UploadedFile() file?: UploadedDocument) {
    if (!this.ingestion) throw new ServiceUnavailableException('The upload worker is unavailable.');
    return this.execute(user.id, async () => {
      const text = await extractDocument(file);
      const source = file!.originalname;
      const id = createHash('sha256').update(source).update('\0').update(text).digest('hex');
      const mime = source.toLowerCase().endsWith('.pdf') ? 'application/pdf' : source.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain; charset=utf-8';
      return this.ingestion!.enqueue(user.id, id, text, { bytes: file!.buffer, name: source, mime });
    });
  }

  @Get('uploads')
  uploads(@CurrentUser() user: Account, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.ingestion?.list(user.id) ?? [];
  }

  @Post('uploads/:id/retry')
  retryUpload(@CurrentUser() user: Account, @Param('id') id: string) {
    if (!this.ingestion) throw new ServiceUnavailableException('The upload worker is unavailable.');
    return this.execute(user.id, () => this.ingestion!.retry(user.id, id));
  }

  @Delete('uploads/:id')
  discardUpload(@CurrentUser() user: Account, @Param('id') id: string) {
    if (!this.ingestion) throw new ServiceUnavailableException('The upload worker is unavailable.');
    return this.ingestion.discard(user.id, id);
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
    if (previous) {
      if (dto.asOf && previous.temporalScope?.from !== dto.asOf) throw new ConflictException('This request ID was already used for a different effective date. Send a new request.');
      return { ...previous, ...(previous.sourceRevision === undefined ? {} : { sourcesChanged: previous.sourceRevision !== await this.database.revision(user.id) }), conversationId, messageId };
    }
    return this.execute(user.id, async () => {
      await this.database.beginMessage(user.id, conversationId, dto.query, messageId);
      try {
        const result = await this.rag.queryPipeline(dto.query, user.id, conversationId, { asOf: dto.asOf });
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
  conversations(@CurrentUser() user: Account, @Query() query: HistoryQueryDto) { return this.database.conversations(user.id, query.before); }

  @Get('messages/:id')
  savedAnswer(@CurrentUser() user: Account, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.database.savedAnswer(user.id, id);
  }

  @Get('conversations/:id/messages')
  conversationMessages(@CurrentUser() user: Account, @Param('id') id: string, @Query() query: HistoryQueryDto) {
    return this.database.conversationMessages(user.id, id, query.before);
  }

  @Get('conflicts')
  conflicts(@CurrentUser() user: Account, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.database.conflicts(user.id);
  }

  @Post('conflicts/archive')
  @HttpCode(HttpStatus.OK)
  clearConflictHistory(@CurrentUser() user: Account, @Body() dto: ClearConflictHistoryDto) {
    return this.execute(user.id, async () => {
      const legacy = (await this.database.conflicts(user.id)).records;
      return this.database.archiveConflicts(user.id, dto.records, legacy);
    });
  }

  @Post('conflicts/:id/decision')
  async decide(@CurrentUser() user: Account, @Param('id') id: string, @Body() dto: ConflictDecisionDto) {
    return this.execute(user.id, async () => {
      if (await this.database.get('SELECT id FROM evidence_conflicts WHERE owner_id=? AND id=?', user.id, id)) return this.database.decideConflict(user.id, id, dto);
      const conflict = (await this.database.conflicts(user.id)).records.find(c => c.id === id);
      if (!conflict) throw new NotFoundException('Conflict not found.');
      return this.database.decideConflict(user.id, id, dto, conflict);
    });
  }
  @Get('conflicts/:id/history')
  async conflictHistory(@CurrentUser() user: Account, @Param('id') id: string) {
    await this.requireConflict(user.id, id);
    return this.database.knowledgeEvents(user.id, id);
  }
  private async requireConflict(owner: string, id: string) {
    if (!await this.database.get('SELECT id FROM evidence_conflicts WHERE owner_id=? AND id=?', owner, id)
      && !(await this.database.conflicts(owner)).records.some(c => c.id === id)) throw new NotFoundException('Conflict not found.');
  }
  @Get('conflicts/:id/decision-history')
  async decisionHistory(@CurrentUser() user: Account, @Param('id') id: string, @Query() query: LifecycleHistoryQueryDto) {
    await this.requireConflict(user.id, id);
    return this.database.knowledgeEventPage(user.id, id, query.limit, query.cursor);
  }
  @Get('docs/:id/metadata')
  metadata(@CurrentUser() user: Account, @Param('id') id: string) { return this.database.metadata(user.id, id); }
  @Put('docs/:id/metadata')
  updateMetadata(@CurrentUser() user: Account, @Param('id') id: string, @Body() dto: UpdateMetadataDto) {
    return this.execute(user.id, () => this.database.updateMetadata(user.id, id, dto.metadata, dto.expectedRevision, dto.reason));
  }
  @Get('docs/:id/versions')
  versions(@CurrentUser() user: Account, @Param('id') id: string) { return this.database.documentVersions(user.id, id); }
  @Get('docs/:id/version-history')
  versionHistory(@CurrentUser() user: Account, @Param('id') id: string, @Query() query: LifecycleHistoryQueryDto) {
    return this.database.documentVersionPage(user.id, id, query.limit, query.cursor);
  }
  @Get('docs/:id/versions/:versionId')
  version(@CurrentUser() user: Account, @Param('id') id: string, @Param('versionId') versionId: string) {
    return this.database.documentVersion(user.id, id, versionId);
  }
  @Get('messages/:id/versions')
  answerVersions(@CurrentUser() user: Account, @Param('id') id: string) { return this.database.answerVersions(user.id, id); }
  @Get('messages/:id/version-history')
  answerVersionHistory(@CurrentUser() user: Account, @Param('id') id: string, @Query() query: LifecycleHistoryQueryDto) {
    return this.database.answerVersionPage(user.id, id, query.limit, query.cursor);
  }
  @Get('messages/:id/revalidation-history')
  async revalidationHistory(@CurrentUser() user: Account, @Param('id') id: string, @Query() query: LifecycleHistoryQueryDto) {
    if (!await this.database.get('SELECT id FROM messages WHERE owner_id=? AND id=?', user.id, id)) throw new NotFoundException('Answer not found.');
    return this.database.knowledgeEventPage(user.id, id, query.limit, query.cursor);
  }
  @Post('messages/:id/revalidate')
  revalidate(@CurrentUser() user: Account, @Param('id') id: string) {
    if (!this.revalidation) throw new ServiceUnavailableException('Revalidation is unavailable.');
    return this.execute(user.id, () => this.revalidation!.request(user.id, id));
  }
  @Get('revalidations')
  revalidations(@CurrentUser() user: Account) {
    if (!this.revalidation) throw new ServiceUnavailableException('Revalidation is unavailable.');
    return this.revalidation.list(user.id);
  }

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
