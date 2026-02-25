import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SalesPlaybooksService, PlaybookPayload } from './sales-playbooks.service';

@ApiTags('sales-playbooks')
@Controller('sales-playbooks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'sales_manager', 'sales_rep')
export class SalesPlaybooksController {
  constructor(private readonly salesPlaybooksService: SalesPlaybooksService) {}

  @Get()
  @ApiOperation({ summary: 'List active sales playbooks (optional slug filter)' })
  async list(@Query('slug') slug?: string) {
    const data = await this.salesPlaybooksService.findAll(slug);
    return { data };
  }

  @Get('by-slug/:slug')
  @ApiOperation({ summary: 'Get playbook by slug' })
  async getBySlug(@Param('slug') slug: string) {
    const data = await this.salesPlaybooksService.getBySlug(slug);
    return { data };
  }

  @Get('resolve-variables/:id')
  @ApiOperation({ summary: 'Get playbook payload with variables resolved from context' })
  async resolveVariables(
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    const context: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(query)) {
      context[k] = v;
    }
    const data = await this.salesPlaybooksService.resolveVariables(id, context);
    return { data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get playbook by id' })
  async getOne(@Param('id') id: string) {
    const data = await this.salesPlaybooksService.findOne(id);
    return { data };
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Create playbook (admin only)' })
  async create(
    @Body()
    body: {
      name: string;
      slug: string;
      description?: string;
      payload: PlaybookPayload;
      isActive?: boolean;
    },
  ) {
    const data = await this.salesPlaybooksService.create(body);
    return { data };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Update playbook (admin only)' })
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      description?: string;
      payload?: PlaybookPayload;
      isActive?: boolean;
    },
  ) {
    const data = await this.salesPlaybooksService.update(id, body);
    return { data };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @ApiOperation({ summary: 'Delete playbook (admin only)' })
  async remove(@Param('id') id: string) {
    return await this.salesPlaybooksService.remove(id);
  }
}
