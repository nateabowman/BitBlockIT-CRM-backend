import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuppressionService } from './suppression.service';
import { SuppressionController } from './suppression.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SuppressionController],
  providers: [SuppressionService],
  exports: [SuppressionService],
})
export class SuppressionModule {}
