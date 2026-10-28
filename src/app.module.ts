import { Module } from '@nestjs/common';
import { VectorStoreModule } from './vector-store/vector-store.module';
import { RagModule } from './rag/rag.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule, VectorStoreModule, RagModule],
})
export class AppModule {}
