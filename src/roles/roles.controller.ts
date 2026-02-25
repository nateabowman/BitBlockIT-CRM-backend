import { Controller, Get, Post, Patch, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(JwtAuthGuard)
export class RolesController {
  constructor(private service: RolesService) {}

  @Get()
  list() {
    return this.service.findAll().then((data) => ({ data }));
  }

  @Get('permissions')
  listPermissions() {
    return this.service.findAllPermissions().then((data) => ({ data }));
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.service.findOne(id).then((data) => ({ data }));
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(@Body() body: { name: string; description?: string }) {
    return this.service.create(body).then((data) => ({ data }));
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string }) {
    return this.service.update(id, body).then((data) => ({ data }));
  }

  @Put(':id/permissions')
  @UseGuards(RolesGuard)
  @Roles('admin')
  setPermissions(@Param('id') id: string, @Body() body: { permissionIds: string[] }) {
    return this.service.setPermissions(id, body.permissionIds ?? []).then((data) => ({ data }));
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
