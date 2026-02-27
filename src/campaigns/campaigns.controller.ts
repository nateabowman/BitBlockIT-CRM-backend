import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  async create(@Body() dto: CreateCampaignDto) {
    const data = await this.campaignsService.create(dto);
    return { data };
  }

  @Get()
  async findAll() {
    const data = await this.campaignsService.findAll();
    return { data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.campaignsService.findOne(id);
    return { data };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    const data = await this.campaignsService.update(id, dto);
    return { data };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.campaignsService.remove(id);
  }

  @Post(':id/send')
  async sendNow(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.campaignsService.sendNow(id, userId);
  }

  @Post(':id/schedule')
  async schedule(
    @Param('id') id: string,
    @Body() body: { scheduledAt: string },
    @CurrentUser('sub') userId: string,
  ) {
    return this.campaignsService.schedule(id, body.scheduledAt, userId);
  }

  @Post(':id/clone')
  async clone(@Param('id') id: string) {
    const data = await this.campaignsService.clone(id);
    return { data };
  }

  @Get(':id/ab-summary')
  async getAbSummary(@Param('id') id: string) {
    return this.campaignsService.getAbSummary(id);
  }

  @Post(':id/apply-ab-winner')
  async applyAbWinner(@Param('id') id: string) {
    return this.campaignsService.applyAbWinner(id);
  }

  @Post(':id/send-remainder')
  async sendRemainder(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.campaignsService.sendRemainderToNonOpeners(id, userId);
  }

  @Get(':id/link-clicks')
  async getLinkClicks(@Param('id') id: string) {
    return this.campaignsService.getLinkClicks(id);
  }

  @Get(':id/failed-sends')
  async getFailedSends(@Param('id') id: string) {
    return this.campaignsService.getFailedSends(id);
  }

  @Get(':id/send-log')
  async getSendLog(
    @Param('id') id: string,
    @Query('format') format?: string,
    @Res() res?: Response,
  ) {
    const result = await this.campaignsService.getSendLog(id, format === 'csv' ? 'csv' : 'json');
    if (format === 'csv' && (result as { contentType?: string }).contentType && res) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="campaign-${id}-send-log.csv"`);
      return res.send((result as { data: string }).data);
    }
    return result;
  }

  @Post(':id/send-to-engaged')
  async sendToEngaged(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.campaignsService.sendToEngaged(id, userId);
  }
}
