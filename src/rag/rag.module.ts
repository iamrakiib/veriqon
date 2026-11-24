import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RagController } from './rag.controller';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { IngestionService } from './ingestion.service';
import { RevalidationService } from './revalidation.service';
import { JobQueueService } from './job-queue.service';

@Module({
  imports: [VectorStoreModule],
  providers: [RagService, IngestionService, RevalidationService, JobQueueService],
  controllers: [RagController],
})
export class RagModule {}
