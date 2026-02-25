import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { OptionListsService } from './option-lists.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('option-lists')
@UseGuards(JwtAuthGuard)
export class OptionListsController {
  constructor(private optionListsService: OptionListsService) {}

  @Get()
  async list(@Query('type') type: string, @Query('pipelineId') pipelineId?: string) {
    if (!type) return { data: [] };
    const data = await this.optionListsService.findByType(type, pipelineId);
    return { data };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(
    @Body() body: { type: string; value: string; label: string; pipelineId?: string; order?: number },
  ) {
    return { data: await this.optionListsService.create(body) };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(@Param('id') id: string, @Body() body: { value?: string; label?: string; order?: number }) {
    return { data: await this.optionListsService.update(id, body) };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return await this.optionListsService.remove(id);
  }
}
