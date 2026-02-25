import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('teams')
@UseGuards(JwtAuthGuard)
export class TeamsController {
  constructor(private service: TeamsService) {}

  @Get()
  async list() {
    return { data: await this.service.findAll() };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(@Body() body: { name: string; description?: string }) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() body: { name?: string; description?: string }) {
    return { data: await this.service.update(id, body) };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
