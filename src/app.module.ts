import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LeadsModule } from './leads/leads.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ContactsModule } from './contacts/contacts.module';
import { PipelinesModule } from './pipelines/pipelines.module';
import { ActivitiesModule } from './activities/activities.module';
import { ReportsModule } from './reports/reports.module';
import { EmailModule } from './email/email.module';
import { SegmentsModule } from './segments/segments.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { SequencesModule } from './sequences/sequences.module';
import { TrackingModule } from './tracking/tracking.module';
import { FormsModule } from './forms/forms.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { PreferenceCenterModule } from './preference-center/preference-center.module';
import { AuditModule } from './audit/audit.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { TagsModule } from './tags/tags.module';
import { OptionListsModule } from './option-lists/option-lists.module';
import { CustomFieldDefinitionsModule } from './custom-field-definitions/custom-field-definitions.module';
import { LeadScoringRulesModule } from './lead-scoring-rules/lead-scoring-rules.module';
import { LeadAssignmentRulesModule } from './lead-assignment-rules/lead-assignment-rules.module';
import { SavedLeadViewsModule } from './saved-lead-views/saved-lead-views.module';
import { ActivityTypesModule } from './activity-types/activity-types.module';
import { NotificationsModule } from './notifications/notifications.module';
import { TeamsModule } from './teams/teams.module';
import { RolesModule } from './roles/roles.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { TicketsModule } from './tickets/tickets.module';
import { SearchModule } from './search/search.module';
import { AdminModule } from './admin/admin.module';
import { AssetsModule } from './assets/assets.module';
import { SuppressionModule } from './suppression/suppression.module';
import { ApolloModule } from './apollo/apollo.module';
import { TwilioModule } from './twilio/twilio.module';
import { SalesPlaybooksModule } from './sales-playbooks/sales-playbooks.module';
import { AutomationModule } from './automation/automation.module';
import { AiModule } from './ai/ai.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { LoggerService } from './common/logger.service';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { MetricsService } from './common/metrics.service';
import { MetricsInterceptor } from './common/metrics.interceptor';
import { InMemoryCacheInterceptor } from './common/cache.interceptor';

@Module({
  providers: [
    LoggerService,
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: InMemoryCacheInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    RolesGuard,
  ],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'short', ttl: 60000, limit: 300 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    TagsModule,
    OptionListsModule,
    CustomFieldDefinitionsModule,
    LeadScoringRulesModule,
    LeadAssignmentRulesModule,
    SavedLeadViewsModule,
    TeamsModule,
    RolesModule,
    LeadsModule,
    OrganizationsModule,
    ContactsModule,
    PipelinesModule,
    ActivityTypesModule,
    ActivitiesModule,
    NotificationsModule,
    ReportsModule,
    EmailModule,
    SegmentsModule,
    CampaignsModule,
    SequencesModule,
    TrackingModule,
    FormsModule,
    WebhooksModule,
    PreferenceCenterModule,
    ApiKeysModule,
    TicketsModule,
    SearchModule,
    AuditModule,
    AdminModule,
    AssetsModule,
    SuppressionModule,
    ApolloModule,
    TwilioModule,
    SalesPlaybooksModule,
    AutomationModule,
    AiModule,
    IntegrationsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
