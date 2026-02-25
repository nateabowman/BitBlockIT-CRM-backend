import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ActivityTypesService } from './activity-types.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('activity-types')
@UseGuards(JwtAuthGuard)
export class ActivityTypesController {
  constructor(private service: ActivityTypesService) {}

  @Get()
  async list() {
    return { data: await this.service.findAll() };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() body: { name: string; slug: string; isTask?: boolean; order?: number }) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() body: { name?: string; slug?: string; isTask?: boolean; order?: number },
  ) {
    return { data: await this.service.update(id, body) };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
