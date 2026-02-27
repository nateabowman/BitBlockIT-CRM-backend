import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('assets')
export class AssetsController {
  constructor(private assetsService: AssetsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async list(@Query('type') type?: string) {
    const data = await this.assetsService.findAll(type);
    return { data };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async one(@Param('id') id: string) {
    const data = await this.assetsService.findOne(id);
    return { data };
  }

  @Get(':id/download-stats')
  @UseGuards(JwtAuthGuard)
  async downloadStats(
    @Param('id') id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const data = await this.assetsService.getDownloadStats(id, dateFrom, dateTo);
    return { data };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() body: { name: string; type: string; storageKey: string; url?: string; isGated?: boolean },
  ) {
    const data = await this.assetsService.create(body);
    return { data };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; type?: string; storageKey?: string; url?: string; isGated?: boolean },
  ) {
    const data = await this.assetsService.update(id, body);
    return { data };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string) {
    return await this.assetsService.remove(id);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @Post(':id/download')
  async requestDownload(
    @Param('id') id: string,
    @Body() body: { contactId?: string; leadId?: string; email?: string },
  ) {
    const data = await this.assetsService.requestDownload(id, body);
    return { data };
  }

  @Get(':id/analytics')
  async getAnalytics(@Param('id') id: string) {
    return { data: await this.assetsService.getAnalytics(id) };
  }
}
