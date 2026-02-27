import { Controller, Get, Post, UseGuards, Res, Query } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { AdminService } from './admin.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PaginationDto } from '../common/dto/pagination.dto';

@ApiTags('admin')
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Aggregate stats for admin dashboard' })
  @ApiResponse({ status: 200, description: 'Stats returned' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getStats() {
    return this.adminService.getStats();
  }

  @Get('health')
  @ApiOperation({ summary: 'Database health check (Prisma ping)' })
  @ApiResponse({ status: 200, description: 'Health status' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getHealth() {
    return this.adminService.getHealth();
  }

  @Get('campaigns/ab-summary')
  @ApiOperation({ summary: 'A/B campaign send counts by variant' })
  @ApiResponse({ status: 200, description: 'Campaigns with A/B and variant counts' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getCampaignsAbSummary() {
    return this.adminService.getCampaignsAbSummary();
  }

  @Get('export/contacts')
  @ApiOperation({ summary: 'Export all contacts as CSV (admin only)' })
  @ApiResponse({ status: 200, description: 'CSV file' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async exportContacts(@Res() res: Response) {
    const csv = await this.adminService.exportContactsCsv();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=contacts-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  }

  @Get('calls')
  @ApiOperation({ summary: 'List call records (admin only); filter by userId, fromDate, toDate' })
  @ApiResponse({ status: 200, description: 'Paginated call records' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getCalls(
    @Query() pagination: PaginationDto,
    @Query('userId') userId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    return this.adminService.getCalls({ userId, fromDate, toDate, page, limit });
  }

  @Get('call-intelligence')
  @ApiOperation({ summary: 'Call KPIs by rep: calls, connect rate, close rate' })
  @ApiResponse({ status: 200, description: 'Call intelligence metrics' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getCallIntelligence(
    @Query('userId') userId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.adminService.getCallIntelligence({ userId, fromDate, toDate });
  }

  @Get('sms')
  @ApiOperation({ summary: 'List SMS messages (admin only); filter by userId, fromDate, toDate' })
  @ApiResponse({ status: 200, description: 'Paginated SMS messages' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async getSms(
    @Query() pagination: PaginationDto,
    @Query('userId') userId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    return this.adminService.getSms({ userId, fromDate, toDate, page, limit });
  }

  // Item 445: Admin billing routes
  @Post('billing/backfill')
  @ApiOperation({ summary: 'Backfill billing customers for all customer-type orgs without billingCustomerId' })
  @ApiResponse({ status: 200, description: 'Backfill result: { synced, failed, skipped }' })
  async backfillBilling() {
    return this.organizationsService.backfillBillingCustomers();
  }
}
