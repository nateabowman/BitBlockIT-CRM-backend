import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SavedLeadViewsService } from './saved-lead-views.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('saved-lead-views')
@UseGuards(JwtAuthGuard)
export class SavedLeadViewsController {
  constructor(private service: SavedLeadViewsService) {}

  @Get()
  async list(@CurrentUser('sub') userId: string) {
    const data = await this.service.findByUser(userId);
    return { data };
  }

  @Post()
  async create(
    @CurrentUser('sub') userId: string,
    @Body()
    body: {
      name: string;
      filters: Record<string, unknown>;
      sort?: Record<string, string>;
      columns?: string[];
    },
  ) {
    return { data: await this.service.create(userId, body) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @Body()
    body: {
      name?: string;
      filters?: Record<string, unknown>;
      sort?: Record<string, string>;
      columns?: string[];
    },
  ) {
    return { data: await this.service.update(id, userId, body) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return await this.service.remove(id, userId);
  }
}
