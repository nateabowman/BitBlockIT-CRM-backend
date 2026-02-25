import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { AuditModule } from '../audit/audit.module';
import { LeadAssignmentRulesModule } from '../lead-assignment-rules/lead-assignment-rules.module';
import { LeadScoringRulesModule } from '../lead-scoring-rules/lead-scoring-rules.module';
import { EmailModule } from '../email/email.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [
    MulterModule.register({ storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }),
    AuditModule,
    LeadAssignmentRulesModule,
    LeadScoringRulesModule,
    EmailModule,
    WebhooksModule,
  ],
  providers: [LeadsService],
  controllers: [LeadsController],
  exports: [LeadsService],
})
export class LeadsModule {}
