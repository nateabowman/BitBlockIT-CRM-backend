import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';

@Controller('pipelines')
@UseGuards(JwtAuthGuard)
export class PipelinesController {
  constructor(private pipelinesService: PipelinesService) {}

  @Get()
  async list(@Query('type') type?: string) {
    const data = await this.pipelinesService.findAll();
    const filtered = type ? data.filter((p) => p.type === type) : data;
    return { data: filtered };
  }

  @Get(':id')
  async one(@Param('id') id: string) {
    return { data: await this.pipelinesService.findOne(id) };
  }

  @Post()
  async create(@Body() dto: CreatePipelineDto) {
    return { data: await this.pipelinesService.create(dto) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePipelineDto) {
    return { data: await this.pipelinesService.update(id, dto) };
  }

  @Get(':id/stages')
  async stages(@Param('id') id: string) {
    return { data: await this.pipelinesService.getStages(id) };
  }

  @Post(':id/stages')
  async createStage(@Param('id') id: string, @Body() dto: CreateStageDto) {
    return { data: await this.pipelinesService.createStage(id, dto) };
  }

  @Patch(':id/stages/reorder')
  async reorderStages(@Param('id') id: string, @Body() body: { stageIds: string[] }) {
    return { data: await this.pipelinesService.reorderStages(id, body.stageIds) };
  }

  @Patch(':id/stages/:stageId')
  async updateStage(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Body() dto: UpdateStageDto,
  ) {
    return { data: await this.pipelinesService.updateStage(id, stageId, dto) };
  }

  @Delete(':id/stages/:stageId')
  async deleteStage(@Param('id') id: string, @Param('stageId') stageId: string) {
    return await this.pipelinesService.deleteStage(id, stageId);
  }

  @Post(':id/clone')
  async clone(@Param('id') id: string) {
    return { data: await this.pipelinesService.clone(id) };
  }

  @Get(':id/analytics')
  async analytics(@Param('id') id: string) {
    return { data: await this.pipelinesService.getAnalytics(id) };
  }

  @Get(':id/forecast')
  async forecast(@Param('id') id: string, @Query('groupBy') groupBy?: 'assignee' | 'team') {
    return { data: await this.pipelinesService.getForecast(id, groupBy) };
  }
}
