import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { WebhooksController } from './webhooks.controller';
import { EmailWebhooksController } from './email-webhooks.controller';
import { WebhookOutboundService } from './webhook-outbound.service';
import { WebhookLeadsLogService } from './webhook-leads-log.service';
import { WebhookLeadsLogFilter } from './webhook-leads-log.filter';
import { ApolloModule } from '../apollo/apollo.module';

@Module({
  imports: [ApolloModule],
  controllers: [WebhooksController, EmailWebhooksController],
  providers: [
    WebhookOutboundService,
    WebhookLeadsLogService,
    {
      provide: APP_FILTER,
      useFactory: (logService: WebhookLeadsLogService) => new WebhookLeadsLogFilter(logService),
      inject: [WebhookLeadsLogService],
    },
  ],
  exports: [WebhookOutboundService],
})
export class WebhooksModule {}
