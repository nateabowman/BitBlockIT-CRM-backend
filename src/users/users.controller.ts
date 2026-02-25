import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdateMeDto } from './dto/update-me.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { paginate } from '../common/dto/pagination.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async me(@CurrentUser('sub') userId: string) {
    return { data: await this.usersService.getMe(userId) };
  }

  @Patch('me')
  async updateMe(@CurrentUser('sub') userId: string, @Body() dto: UpdateMeDto) {
    return { data: await this.usersService.updateMe(userId, dto) };
  }

  @Post('me/revoke-all')
  async revokeAllSessions(@CurrentUser('sub') userId: string) {
    return await this.usersService.revokeAllSessions(userId);
  }

  @Get('assignable')
  async assignable() {
    return { data: await this.usersService.findAssignable() };
  }

  @Post('invite')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async invite(@Body() body: { email: string; name?: string; roleId: string; teamId?: string }) {
    return { data: await this.usersService.createInvite(body) };
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('admin')
  async list(@Query() pagination: PaginationDto, @Query('includeInactive') includeInactive?: string) {
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 20;
    const { data, total } = await this.usersService.findAll({
      skip: (page - 1) * limit,
      take: limit,
      includeInactive: includeInactive === 'true',
    });
    return paginate(data, total, page, limit);
  }

  @Get(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async one(@Param('id') id: string) {
    const user = await this.usersService.findById(id);
    const { passwordHash, ...rest } = user as unknown as { passwordHash?: string; [k: string]: unknown };
    return { data: rest };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMeDto & { teamId?: string; isActive?: boolean },
  ) {
    const data: Prisma.UserUncheckedUpdateInput = { ...dto, notificationPrefs: (dto as { notificationPrefs?: unknown }).notificationPrefs as Prisma.InputJsonValue | undefined };
    return { data: await this.usersService.update(id, data) };
  }
}
