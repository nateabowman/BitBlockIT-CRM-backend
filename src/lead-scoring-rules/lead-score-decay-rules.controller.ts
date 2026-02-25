import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { LeadScoreDecayRulesService } from './lead-score-decay-rules.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('lead-score-decay-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class LeadScoreDecayRulesController {
  constructor(private service: LeadScoreDecayRulesService) {}

  @Get()
  async list(@Query('activeOnly') activeOnly?: string) {
    const data = await this.service.findAll(activeOnly === 'true');
    return { data };
  }

  @Post()
  async create(
    @Body()
    body: {
      name: string;
      pointsPerDay: number;
      noActivityDays: number;
      minScore?: number;
      isActive?: boolean;
    },
  ) {
    return { data: await this.service.create(body) };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      pointsPerDay?: number;
      noActivityDays?: number;
      minScore?: number;
      isActive?: boolean;
    },
  ) {
    return { data: await this.service.update(id, body) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
