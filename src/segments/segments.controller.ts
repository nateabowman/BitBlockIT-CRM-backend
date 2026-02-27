import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class GetRecipientsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50000)
  limit?: number = 10000;
}

@Controller('segments')
@UseGuards(JwtAuthGuard)
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Post()
  async create(@Body() createSegmentDto: CreateSegmentDto) {
    const data = await this.segmentsService.create(createSegmentDto);
    return { data };
  }

  @Get()
  async findAll() {
    const data = await this.segmentsService.findAll();
    return { data };
  }

  @Get(':id/count')
  async getRecipientCount(@Param('id') id: string) {
    const count = await this.segmentsService.getRecipientCount(id);
    return { data: { count } };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.segmentsService.findOne(id);
    return { data };
  }

  @Get(':id/recipients')
  async getRecipients(@Param('id') id: string, @Query() query: GetRecipientsQueryDto) {
    const recipients = await this.segmentsService.resolveRecipients(id, query.limit);
    return { data: recipients, count: recipients.length };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateSegmentDto: UpdateSegmentDto) {
    const data = await this.segmentsService.update(id, updateSegmentDto);
    return { data };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.segmentsService.remove(id);
  }

  @Get(':id/health')
  async getHealth(@Param('id') id: string) {
    return { data: await this.segmentsService.getHealth(id) };
  }

  @Get(':id/export')
  async exportCsv(@Param('id') id: string, @Res() res: Response) {
    const csv = await this.segmentsService.exportCsv(id);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=segment-${id}.csv`);
    res.send(csv);
  }

  @Get('overlap')
  async getOverlap(@Query('id1') id1: string, @Query('id2') id2: string) {
    return { data: await this.segmentsService.getOverlap(id1, id2) };
  }
}
