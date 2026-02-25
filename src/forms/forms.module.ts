import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';
import { FormsController } from './forms.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { TrackingModule } from '../tracking/tracking.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, WebhooksModule, TrackingModule, EmailModule],
  controllers: [FormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
