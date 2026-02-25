import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { CustomFieldDefinitionsService } from './custom-field-definitions.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('custom-field-definitions')
@UseGuards(JwtAuthGuard)
export class CustomFieldDefinitionsController {
  constructor(private service: CustomFieldDefinitionsService) {}

  @Get()
  async list(@Query('entity') entity: string) {
    const data = entity ? await this.service.findByEntity(entity) : await this.service.findAll();
    return { data };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(
    @Body()
    body: {
      entity: string;
      fieldKey: string;
      label: string;
      type: string;
      options?: unknown;
      required?: boolean;
      order?: number;
    },
  ) {
    return { data: await this.service.create(body) };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() body: { label?: string; type?: string; options?: unknown; required?: boolean; order?: number },
  ) {
    return { data: await this.service.update(id, body) };
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(@Param('id') id: string) {
    return await this.service.remove(id);
  }
}
