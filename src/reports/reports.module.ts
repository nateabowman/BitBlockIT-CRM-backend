import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { RevenueIntelligenceKeyGuard } from '../common/guards/revenue-intelligence-key.guard';

@Module({
  providers: [ReportsService, RevenueIntelligenceKeyGuard],
  controllers: [ReportsController],
})
export class ReportsModule {}
