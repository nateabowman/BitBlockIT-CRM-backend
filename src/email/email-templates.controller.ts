import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('email-templates')
@UseGuards(JwtAuthGuard)
export class EmailTemplatesController {
  constructor(private service: EmailTemplatesService) {}

  @Get()
  async list(@Query('category') category?: string) {
    const data = await this.service.findAll(category);
    return { data };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.service.findOne(id) };
  }

  @Post()
  async create(@Body() body: { name: string; subject: string; bodyHtml?: string; bodyText?: string; bodyJson?: object; category?: string; fromName?: string; fromEmail?: string }) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; subject?: string; bodyHtml?: string; bodyText?: string; bodyJson?: object; category?: string; fromName?: string | null; fromEmail?: string | null }) {
    return { data: await this.service.update(id, body) };
  }

  @Post(':id/send-test')
  async sendTest(@Param('id') id: string, @Body() body: { to: string }) {
    return await this.service.sendTest(id, body.to);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
