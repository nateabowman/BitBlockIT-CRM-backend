import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { LeadScoringRulesService } from './lead-scoring-rules.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('lead-scoring-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class LeadScoringRulesController {
  constructor(private service: LeadScoringRulesService) {}

  @Get()
  async list() {
    const data = await this.service.findAllAdmin();
    return { data };
  }

  @Post()
  async create(
    @Body()
    body: {
      name: string;
      triggerType: string;
      triggerConfig: Record<string, unknown>;
      points: number;
      isActive?: boolean;
    },
  ) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      triggerType?: string;
      triggerConfig?: Record<string, unknown>;
      points?: number;
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
