import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ScoreTriggersService } from './score-triggers.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('score-triggers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ScoreTriggersController {
  constructor(private service: ScoreTriggersService) {}

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
      threshold: number;
      action: string;
      config: Record<string, unknown>;
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
      threshold?: number;
      action?: string;
      config?: Record<string, unknown>;
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
