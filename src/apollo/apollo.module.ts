import { Module } from '@nestjs/common';
import { ApolloService } from './apollo.service';
import { ApolloController } from './apollo.controller';
import { ApolloQueueService } from './apollo-queue.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ApolloController],
  providers: [ApolloService, ApolloQueueService],
  exports: [ApolloService, ApolloQueueService],
})
export class ApolloModule {}
