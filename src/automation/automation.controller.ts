import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WriteAccessGuard } from '../common/guards/write-access.guard';
import { AutomationService, AutomationRule } from './automation.service';

@Controller('automations')
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(private service: AutomationService) {}

  @Get()
  async list() {
    return { data: await this.service.findAll() };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Post()
  @UseGuards(WriteAccessGuard)
  async create(@Body() body: Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'executionCount' | 'lastExecutedAt'>) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  @UseGuards(WriteAccessGuard)
  async update(@Param('id') id: string, @Body() body: Partial<AutomationRule>) {
    return { data: await this.service.update(id, body) };
  }

  @Patch(':id/toggle')
  @UseGuards(WriteAccessGuard)
  async toggle(@Param('id') id: string) {
    return { data: await this.service.toggle(id) };
  }

  @Delete(':id')
  @UseGuards(WriteAccessGuard)
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
