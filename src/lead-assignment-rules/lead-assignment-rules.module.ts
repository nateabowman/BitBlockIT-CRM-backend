import { Module } from '@nestjs/common';
import { LeadAssignmentRulesService } from './lead-assignment-rules.service';
import { LeadAssignmentRulesController } from './lead-assignment-rules.controller';

@Module({
  providers: [LeadAssignmentRulesService],
  controllers: [LeadAssignmentRulesController],
  exports: [LeadAssignmentRulesService],
})
export class LeadAssignmentRulesModule {}
