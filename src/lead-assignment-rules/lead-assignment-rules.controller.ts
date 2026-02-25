import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { LeadAssignmentRulesService } from './lead-assignment-rules.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('lead-assignment-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class LeadAssignmentRulesController {
  constructor(private service: LeadAssignmentRulesService) {}

  @Get()
  async list() {
    const data = await this.service.findAllAdmin();
    return { data };
  }

  @Post()
  async create(@Body() body: { type: string; config: Record<string, unknown>; isActive?: boolean }) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { type?: string; config?: Record<string, unknown>; isActive?: boolean },
  ) {
    return { data: await this.service.update(id, body) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
