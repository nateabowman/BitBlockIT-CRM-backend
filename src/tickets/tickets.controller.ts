import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(private ticketsService: TicketsService) {}

  @Post()
  async create(@Body() dto: CreateTicketDto) {
    return { data: await this.ticketsService.create(dto) };
  }

  @Get()
  async list(
    @Query('leadId') leadId?: string,
    @Query('organizationId') organizationId?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.ticketsService.findAll({ leadId, organizationId, status });
    return { data };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.ticketsService.findOne(id) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return { data: await this.ticketsService.update(id, dto) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return await this.ticketsService.remove(id);
  }
}
