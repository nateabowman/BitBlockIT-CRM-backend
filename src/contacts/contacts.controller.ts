import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { ContactsService } from './contacts.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { paginate } from '../common/dto/pagination.dto';

@Controller('contacts')
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  private access(user?: JwtPayload) {
    return user ? { role: user.role, teamId: user.teamId } : undefined;
  }

  @Get()
  async list(@Query() pagination: PaginationDto, @CurrentUser() user?: JwtPayload) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const { data, total } = await this.contactsService.findAll((page - 1) * limit, limit, this.access(user));
    return paginate(data, total, page, limit);
  }

  @Get(':id/export-data')
  async exportData(@Param('id') id: string, @Res() res: Response, @CurrentUser() user?: JwtPayload) {
    const data = await this.contactsService.exportDataForContact(id, this.access(user));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="contact-${id}-export.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Get(':id/gdpr-export')
  async gdprExport(@Param('id') id: string, @Res() res: Response, @CurrentUser() user?: JwtPayload) {
    const data = await this.contactsService.gdprExport(id, this.access(user));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="contact-${id}-gdpr-export.json"`);
    res.send(JSON.stringify(data, null, 2));
  }

  @Get(':id/email-timeline')
  async emailTimeline(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return this.contactsService.getEmailTimeline(id, this.access(user));
  }

  @Get(':id')
  async one(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return { data: await this.contactsService.findOne(id, this.access(user)) };
  }

  @Post()
  async create(@Body() dto: CreateContactDto) {
    return { data: await this.contactsService.create(dto) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateContactDto, @CurrentUser() user?: JwtPayload) {
    return { data: await this.contactsService.update(id, dto, this.access(user)) };
  }

  @Get(':id/activities')
  async activities(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return { data: await this.contactsService.getActivities(id, this.access(user)) };
  }

  @Delete(':id/permanent')
  async hardDelete(@Param('id') id: string, @CurrentUser('sub') userId?: string, @CurrentUser() user?: JwtPayload) {
    return await this.contactsService.hardDeleteContact(id, userId, this.access(user));
  }

  @Post(':id/gdpr-erase')
  async gdprErase(@Param('id') id: string, @CurrentUser('sub') userId?: string) {
    return await this.contactsService.gdprErase(id, userId);
  }

  @Get(':id/last-contacted')
  async lastContacted(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return { data: await this.contactsService.getLastContacted(id, this.access(user)) };
  }
}
