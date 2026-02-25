import { Controller, Get, Patch, Param, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser('sub') userId: string,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('limit') limit?: string,
  ) {
    const data = await this.service.findForUser(
      userId,
      unreadOnly === 'true',
      limit ? parseInt(limit, 10) : 50,
    );
    return { data };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser('sub') userId: string) {
    return await this.service.markAllRead(userId);
  }

  @Patch(':id/read')
  async markRead(@Param('id') id: string, @CurrentUser('sub') userId: string) {
    return await this.service.markRead(id, userId);
  }
}
