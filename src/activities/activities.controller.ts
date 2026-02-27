import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ActivitiesService } from './activities.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateActivityDto } from './dto/create-activity.dto';
import { UpdateActivityDto } from './dto/update-activity.dto';

@Controller('activities')
@UseGuards(JwtAuthGuard)
export class ActivitiesController {
  constructor(private activitiesService: ActivitiesService) {}

  @Get()
  async list(
    @Query('leadId') leadId?: string,
    @Query('contactId') contactId?: string,
    @Query('userId') userId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('type') type?: string,
    @Query('outcome') outcome?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('scheduledFrom') scheduledFrom?: string,
    @Query('scheduledTo') scheduledTo?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const result = await this.activitiesService.findAll({
      leadId,
      contactId,
      userId,
      assignedToId,
      type,
      outcome,
      dateFrom,
      dateTo,
      scheduledFrom,
      scheduledTo,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
    return { data: result.data, meta: { total: result.total, page: result.page, limit: result.limit } };
  }

  @Get('export')
  async export(
    @Res() res: Response,
    @Query('leadId') leadId?: string,
    @Query('userId') userId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('type') type?: string,
    @Query('outcome') outcome?: string,
  ) {
    const csv = await this.activitiesService.exportCsv({ leadId, userId, assignedToId, dateFrom, dateTo, type, outcome });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=activities.csv');
    res.send(csv);
  }

  @Get('upcoming')
  async upcoming(@CurrentUser('sub') userId: string, @Query('limit') limit?: string) {
    const data = await this.activitiesService.findUpcoming(userId, limit ? parseInt(limit, 10) : 20);
    return { data };
  }

  @Get('overdue')
  async overdue(@CurrentUser('sub') userId: string, @Query('limit') limit?: string) {
    const data = await this.activitiesService.findOverdue(userId, limit ? parseInt(limit, 10) : 50);
    return { data };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.activitiesService.findOne(id) };
  }

  @Post()
  async create(@CurrentUser('sub') userId: string, @Body() dto: CreateActivityDto) {
    return { data: await this.activitiesService.create(userId, dto) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateActivityDto) {
    return { data: await this.activitiesService.update(id, dto) };
  }

  @Patch(':id/complete')
  async complete(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return { data: await this.activitiesService.completeTask(id, userId) };
  }

  @Patch(':id/reschedule')
  async reschedule(@Param('id') id: string, @Body() body: { scheduledAt: string }) {
    return { data: await this.activitiesService.reschedule(id, new Date(body.scheduledAt)) };
  }

  @Post(':id/attachments')
  async addAttachment(
    @Param('id') id: string,
    @Body() body: { storageKey: string; fileName: string; mimeType?: string; sizeBytes?: number },
  ) {
    return { data: await this.activitiesService.addAttachment(id, body) };
  }

  @Delete(':id/attachments/:attachmentId')
  async removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string) {
    return await this.activitiesService.removeAttachment(id, attachmentId);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.activitiesService.remove(id);
  }

  @Post('bulk-complete')
  async bulkComplete(@Body() body: { activityIds: string[] }, @CurrentUser('sub') userId: string) {
    return { data: await this.activitiesService.bulkComplete(body.activityIds, userId) };
  }

  @Post('bulk-delete')
  async bulkDelete(@Body() body: { activityIds: string[] }) {
    return { data: await this.activitiesService.bulkDelete(body.activityIds) };
  }

  @Get('templates')
  async getTemplates(@CurrentUser('sub') userId: string) {
    return { data: await this.activitiesService.getTemplates(userId) };
  }

  @Post('templates')
  async createTemplate(@CurrentUser('sub') userId: string, @Body() body: { name: string; type: string; subject?: string; body?: string; durationMinutes?: number }) {
    return { data: await this.activitiesService.createTemplate(userId, body) };
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return await this.activitiesService.deleteTemplate(id, userId);
  }

  @Patch(':id/snooze')
  async snooze(@Param('id') id: string, @Body() body: { snoozeDays?: number; snoozeDate?: string }) {
    const newDate = body.snoozeDate
      ? new Date(body.snoozeDate)
      : new Date(Date.now() + (body.snoozeDays ?? 1) * 24 * 60 * 60 * 1000);
    return { data: await this.activitiesService.reschedule(id, newDate) };
  }

  @Patch(':id/time')
  async logTime(@Param('id') id: string, @Body() body: { durationMinutes: number }) {
    return { data: await this.activitiesService.logTime(id, body.durationMinutes) };
  }

  @Get('streak/:userId')
  async getStreak(@Param('userId') userId: string) {
    return { data: await this.activitiesService.getCompletionStreak(userId) };
  }
}
