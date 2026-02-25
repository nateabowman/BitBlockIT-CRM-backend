import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Res, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { LeadsService } from './leads.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { WriteAccessGuard } from '../common/guards/write-access.guard';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { MoveStageDto } from './dto/move-stage.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { BulkUpdateLeadsDto } from './dto/bulk-update-leads.dto';
import { MergeLeadsDto } from './dto/merge-leads.dto';
import { PromoteToDealDto } from './dto/promote-to-deal.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';

@Controller('leads')
@UseGuards(JwtAuthGuard, WriteAccessGuard)
export class LeadsController {
  constructor(private leadsService: LeadsService) {}

  @Get()
  async list(@Query() query: ListLeadsQueryDto, @CurrentUser() user?: JwtPayload) {
    const tagIds = query.tagIds as string | string[] | undefined;
    const normalized = Array.isArray(tagIds) ? tagIds : tagIds ? [tagIds] : undefined;
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const result = await this.leadsService.findAll(
      { ...query, tagIds: normalized },
      access,
    );
    if ('nextCursor' in result) {
      return { data: result.data, meta: { nextCursor: result.nextCursor, limit: result.limit } };
    }
    return { data: result.data, meta: { total: result.total, page: result.page, limit: result.limit } };
  }

  @Get('export')
  async export(@Query() query: ListLeadsQueryDto, @Res() res: Response, @CurrentUser() user?: JwtPayload) {
    const tagIds = query.tagIds as string | string[] | undefined;
    const normalized = Array.isArray(tagIds) ? tagIds : tagIds ? [tagIds] : undefined;
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const csv = await this.leadsService.exportCsv({ ...query, tagIds: normalized }, access);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
    res.send(csv);
  }

  @Post('bulk')
  async bulkUpdate(@Body() dto: BulkUpdateLeadsDto, @CurrentUser('sub') userId?: string) {
    return { data: await this.leadsService.bulkUpdate(dto.leadIds, { assignedToId: dto.assignedToId, stageId: dto.stageId }, userId) };
  }

  @Post('import')
  async import(@Body() dto: ImportLeadsDto) {
    const mapping = dto.mapping ?? { title: 'title', source: 'source' };
    return { data: await this.leadsService.importCsv(dto.rows, mapping, dto.pipelineId, dto.stageId) };
  }

  @Get(':id/export-data')
  async exportData(@Param('id') id: string, @Res() res: Response, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const data = await this.leadsService.exportDataForLead(id, access);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="lead-${id}-export.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Get(':id/score-history')
  async scoreHistory(@Param('id') id: string, @Query('limit') limit?: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.getScoreHistory(id, limit ? parseInt(limit, 10) : 50, access) };
  }

  @Get(':id/email-timeline')
  async emailTimeline(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return this.leadsService.getEmailTimeline(id, access);
  }

  @Get(':id/activities')
  async activities(@Param('id') id: string, @Query('limit') limit?: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.getActivities(id, limit ? parseInt(limit, 10) : 50, access) };
  }

  @Get(':id/notes')
  async notes(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.getNotes(id, access) };
  }

  @Post(':id/notes')
  async createNote(
    @Param('id') id: string,
    @Body() body: { body?: string },
    @CurrentUser('sub') userId: string | undefined,
    @CurrentUser() user?: JwtPayload,
  ) {
    if (!userId) throw new BadRequestException('You must be signed in to add a note');
    const noteBody = (body?.body ?? '').trim();
    if (!noteBody) throw new BadRequestException('Note content is required');
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.createNote(id, noteBody, userId, access) };
  }

  @Patch(':id/notes/:noteId')
  async updateNote(
    @Param('id') id: string,
    @Param('noteId') noteId: string,
    @Body() body: { body: string },
    @CurrentUser('sub') userId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.updateNote(id, noteId, body.body ?? '', userId, access) };
  }

  @Get(':id/documents')
  async documents(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.getDocuments(id, access) };
  }

  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser('sub') userId: string | undefined,
    @CurrentUser() user?: JwtPayload,
  ) {
    if (!file?.buffer) throw new BadRequestException('File is required');
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return {
      data: await this.leadsService.createDocument(
        id,
        {
          buffer: file.buffer,
          mimetype: file.mimetype ?? 'application/octet-stream',
          originalname: file.originalname ?? 'file',
          size: file.size ?? 0,
        },
        userId ?? null,
        access,
      ),
    };
  }

  @Get(':id/documents/:docId/download')
  async downloadDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Res() res: Response,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const { filePath, fileName, mimeType } = await this.leadsService.getDocumentForDownload(id, docId, access);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '\\"')}"`);
    if (mimeType) res.setHeader('Content-Type', mimeType);
    res.sendFile(filePath);
  }

  @Delete(':id/documents/:docId')
  async deleteDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return await this.leadsService.deleteDocument(id, docId, access);
  }

  @Delete(':id/permanent')
  async hardDelete(@Param('id') id: string, @CurrentUser('sub') userId?: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return await this.leadsService.hardDeleteLead(id, userId, access);
  }

  @Get(':id')
  async one(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.findOne(id, access) };
  }

  @Post()
  async create(@Body() dto: CreateLeadDto) {
    return { data: await this.leadsService.create(dto) };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
    @CurrentUser('sub') userId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.update(id, dto, userId, access) };
  }

  @Post(':id/stage')
  async moveStage(
    @Param('id') id: string,
    @Body() dto: MoveStageDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.moveStage(id, dto.stageId, userId, access) };
  }

  @Post(':id/send-email')
  async sendEmail(
    @Param('id') id: string,
    @Body() dto: SendEmailDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.sendEmail(id, dto.templateId, dto.toEmail, userId, access) };
  }

  @Post(':id/promote-to-deal')
  async promoteToDeal(
    @Param('id') id: string,
    @Body() dto: PromoteToDealDto,
    @CurrentUser('sub') userId: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.promoteToDeal(id, dto.pipelineId, userId, access) };
  }

  @Post(':id/merge')
  async merge(
    @Param('id') keepId: string,
    @Body() dto: MergeLeadsDto,
    @CurrentUser('sub') userId?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return { data: await this.leadsService.merge(keepId, dto.mergeId, userId, access) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    return await this.leadsService.remove(id, access);
  }
}
