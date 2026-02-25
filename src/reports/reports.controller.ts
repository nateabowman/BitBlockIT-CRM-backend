import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RevenueIntelligenceKeyGuard } from '../common/guards/revenue-intelligence-key.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  private access(user?: JwtPayload) {
    return user ? { role: user.role, teamId: user.teamId } : undefined;
  }

  @Get('revenue-intelligence')
  @Public()
  @UseGuards(RevenueIntelligenceKeyGuard)
  async revenueIntelligence() {
    return await this.reportsService.getRevenueIntelligenceDashboard();
  }

  @Get('funnel')
  @UseGuards(JwtAuthGuard)
  async funnel(
    @Query('pipelineId') pipelineId: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getFunnel(pipelineId, dateFrom, dateTo, this.access(user));
  }

  @Get('funnel-comparison')
  @UseGuards(JwtAuthGuard)
  async funnelComparison(
    @Query('pipelineId') pipelineId: string,
    @Query('range1From') range1From: string,
    @Query('range1To') range1To: string,
    @Query('range2From') range2From: string,
    @Query('range2To') range2To: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getFunnelComparison(
      pipelineId,
      { from: range1From, to: range1To },
      { from: range2From, to: range2To },
      this.access(user),
    );
  }

  @Get('lead-velocity')
  @UseGuards(JwtAuthGuard)
  async leadVelocity(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('pipelineId') pipelineId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getLeadVelocity(dateFrom, dateTo, pipelineId, this.access(user));
  }

  @Get('win-rate-by-source')
  @UseGuards(JwtAuthGuard)
  async winRateBySource(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('pipelineId') pipelineId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getWinRateBySource(dateFrom, dateTo, pipelineId, this.access(user));
  }

  @Get('avg-time-to-close')
  @UseGuards(JwtAuthGuard)
  async avgTimeToClose(
    @Query('pipelineId') pipelineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getAvgTimeToClose(pipelineId, dateFrom, dateTo, this.access(user));
  }

  @Get('cohort')
  @UseGuards(JwtAuthGuard)
  async cohort(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('pipelineId') pipelineId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getCohortReport(dateFrom, dateTo, pipelineId, this.access(user));
  }

  @Get('activities')
  @UseGuards(JwtAuthGuard)
  async activities(
    @Query('userId') userId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('groupBy') groupBy?: 'user' | 'type' | 'day',
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = this.access(user);
    return await this.reportsService.getActivitiesReport(userId, dateFrom, dateTo, groupBy ?? 'type', access);
  }

  @Get('leads-summary')
  @UseGuards(JwtAuthGuard)
  async leadsSummary(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getLeadsSummary(dateFrom, dateTo, this.access(user));
  }

  @Get('renewal-forecast')
  @UseGuards(JwtAuthGuard)
  async renewalForecast(@CurrentUser() user?: JwtPayload) {
    return await this.reportsService.getRenewalForecast(this.access(user));
  }

  @Get('attribution')
  @UseGuards(JwtAuthGuard)
  async attribution(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('pipelineId') pipelineId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getAttributionReport(dateFrom, dateTo, pipelineId, this.access(user));
  }

  @Get('utm')
  @UseGuards(JwtAuthGuard)
  async utm(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getUtmReport(dateFrom, dateTo, this.access(user));
  }

  @Get('source-attribution')
  @UseGuards(JwtAuthGuard)
  async sourceAttribution(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('pipelineId') pipelineId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getSourceAttributionReport(dateFrom, dateTo, pipelineId, this.access(user));
  }

  @Get('campaign-comparison')
  @UseGuards(JwtAuthGuard)
  async campaignComparison(
    @Query('campaignIdA') campaignIdA: string,
    @Query('campaignIdB') campaignIdB: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    return await this.reportsService.getCampaignComparison(campaignIdA, campaignIdB);
  }

  @Get('marketing-dashboard')
  @UseGuards(JwtAuthGuard)
  async marketingDashboard(@Query('days') days?: string, @CurrentUser() user?: JwtPayload) {
    const n = days ? parseInt(days, 10) : 30;
    return await this.reportsService.getMarketingDashboard(isNaN(n) ? 30 : Math.min(365, Math.max(1, n)));
  }

  @Get('tracking-events')
  @UseGuards(JwtAuthGuard)
  async trackingEvents(
    @Query('campaignId') campaignId?: string,
    @Query('type') type?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('format') format?: string,
    @Res() res?: Response,
  ) {
    const result = await this.reportsService.getTrackingEventsExport({
      campaignId,
      type: type === 'open' || type === 'click' ? type : undefined,
      dateFrom,
      dateTo,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 100,
      format: format === 'csv' ? 'csv' : 'json',
    });
    if (format === 'csv' && (result as { contentType?: string }).contentType && res) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="tracking-events.csv"');
      return res.send((result as { data: string }).data);
    }
    return result;
  }
}
