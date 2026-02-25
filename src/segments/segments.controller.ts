import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
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
}
