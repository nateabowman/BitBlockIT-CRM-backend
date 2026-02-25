import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { TagsService } from './tags.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('tags')
@UseGuards(JwtAuthGuard)
export class TagsController {
  constructor(private tagsService: TagsService) {}

  @Get()
  async list() {
    const data = await this.tagsService.findAll();
    return { data };
  }

  @Post()
  async create(@Body() body: { name: string; color?: string }) {
    return { data: await this.tagsService.create(body) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; color?: string }) {
    return { data: await this.tagsService.update(id, body) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.tagsService.remove(id);
  }

  @Post('leads/:leadId/add/:tagId')
  async addToLead(@Param('leadId') leadId: string, @Param('tagId') tagId: string) {
    return { data: await this.tagsService.addToLead(leadId, tagId) };
  }

  @Delete('leads/:leadId/remove/:tagId')
  async removeFromLead(@Param('leadId') leadId: string, @Param('tagId') tagId: string) {
    return await this.tagsService.removeFromLead(leadId, tagId);
  }

  @Post('bulk-add')
  async bulkAdd(@Body() body: { leadIds: string[]; tagId: string }) {
    return { data: await this.tagsService.bulkAddTag(body.leadIds, body.tagId) };
  }

  @Post('bulk-remove')
  async bulkRemove(@Body() body: { leadIds: string[]; tagId: string }) {
    return { data: await this.tagsService.bulkRemoveTag(body.leadIds, body.tagId) };
  }
}
