import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SuppressionService } from './suppression.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('suppression')
@UseGuards(JwtAuthGuard)
export class SuppressionController {
  constructor(private readonly suppressionService: SuppressionService) {}

  @Get()
  async findAll() {
    const data = await this.suppressionService.findAll();
    return { data };
  }

  @Post()
  async create(@Body() body: { type: 'email' | 'domain'; value: string }) {
    const data = await this.suppressionService.create(body.type, body.value);
    return { data };
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppressionService.remove(id);
  }
}
