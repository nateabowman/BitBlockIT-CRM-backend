import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { SequencesService } from './sequences.service';
import { CreateSequenceDto } from './dto/create-sequence.dto';
import { UpdateSequenceDto } from './dto/update-sequence.dto';
import { EnrollSequenceDto } from './dto/enroll.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('sequences')
@UseGuards(JwtAuthGuard)
export class SequencesController {
  constructor(private readonly sequencesService: SequencesService) {}

  @Post()
  async create(@Body() dto: CreateSequenceDto) {
    const data = await this.sequencesService.create(dto);
    return { data };
  }

  @Get()
  async findAll() {
    const data = await this.sequencesService.findAll();
    return { data };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const data = await this.sequencesService.findOne(id);
    return { data };
  }

  @Get(':id/performance')
  async getPerformance(@Param('id') id: string) {
    return this.sequencesService.getPerformance(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSequenceDto) {
    const data = await this.sequencesService.update(id, dto);
    return { data };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sequencesService.remove(id);
  }

  @Post(':id/enroll')
  async enroll(@Param('id') id: string, @Body() dto: EnrollSequenceDto) {
    const data = await this.sequencesService.enroll(id, dto.leadId, dto.contactId);
    return { data };
  }

  @Post('enrollments/:enrollmentId/pause')
  async pause(@Param('enrollmentId') enrollmentId: string) {
    return this.sequencesService.pause(enrollmentId);
  }

  @Post('enrollments/:enrollmentId/resume')
  async resume(@Param('enrollmentId') enrollmentId: string) {
    return this.sequencesService.resume(enrollmentId);
  }

  @Get(':id/step-analytics')
  async stepAnalytics(@Param('id') id: string) {
    return this.sequencesService.getStepAnalytics(id);
  }

  @Post('unenroll-lead/:leadId')
  async unenrollByLead(@Param('leadId') leadId: string) {
    return { data: await this.sequencesService.unenrollByLead(leadId) };
  }
}
