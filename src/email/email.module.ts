import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailTemplatesController } from './email-templates.controller';
import { EmailAutomationController } from './email-automation.controller';
import { EmailTemplatesService } from './email-templates.service';
import { EmailAutomationService } from './email-automation.service';

@Module({
  providers: [EmailService, EmailTemplatesService, EmailAutomationService],
  controllers: [EmailTemplatesController, EmailAutomationController],
  exports: [EmailService, EmailTemplatesService, EmailAutomationService],
})
export class EmailModule {}
