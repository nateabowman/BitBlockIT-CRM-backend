import { Controller, Post, Body, Get, Delete, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private apiKeys: ApiKeysService) {}

  @Post()
  async create(@CurrentUser('sub') userId: string, @Body() dto: CreateApiKeyDto) {
    const scopes = dto.scopes?.length ? dto.scopes : ['leads:read', 'leads:write', 'activities:read', 'activities:write'];
    const data = await this.apiKeys.create(userId, dto.name, scopes);
    return { data, message: 'Store the key securely; it will not be shown again.' };
  }

  @Get()
  async list(@CurrentUser('sub') userId: string) {
    const data = await this.apiKeys.findAll(userId);
    return { data };
  }

  @Delete(':id')
  async revoke(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.apiKeys.revoke(id, userId);
  }
}
