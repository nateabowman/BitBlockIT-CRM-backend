import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { paginate } from '../common/dto/pagination.dto';

@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private organizationsService: OrganizationsService) {}

  private access(user?: JwtPayload) {
    return user ? { role: user.role, teamId: user.teamId } : undefined;
  }

  @Get()
  async list(
    @Query() pagination: PaginationDto,
    @Query('type') type?: 'prospect' | 'customer',
    @CurrentUser() user?: JwtPayload,
  ) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const { data, total } = await this.organizationsService.findAll((page - 1) * limit, limit, type, this.access(user));
    return paginate(data, total, page, limit);
  }

  @Get(':id')
  async one(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return { data: await this.organizationsService.findOne(id, this.access(user)) };
  }

  @Post()
  async create(@Body() dto: CreateOrganizationDto) {
    return { data: await this.organizationsService.create(dto) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateOrganizationDto, @CurrentUser() user?: JwtPayload) {
    return { data: await this.organizationsService.update(id, dto, this.access(user)) };
  }

  @Get(':id/contacts')
  async contacts(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return { data: await this.organizationsService.getContacts(id, this.access(user)) };
  }

  @Get(':id/leads')
  async leads(@Param('id') id: string, @CurrentUser() user?: JwtPayload) {
    return { data: await this.organizationsService.getLeads(id, this.access(user)) };
  }
}
