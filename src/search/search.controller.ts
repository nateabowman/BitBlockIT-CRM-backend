import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { SearchService } from './search.service';

@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  async search(
    @Query('q') q: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: JwtPayload,
  ) {
    const limitNum = limit ? Math.min(parseInt(limit, 10) || 5, 20) : 5;
    const access = user ? { role: user.role, teamId: user.teamId } : undefined;
    const data = await this.searchService.search(q?.trim() ?? '', limitNum, access);
    return { data };
  }
}
