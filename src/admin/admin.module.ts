import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LoggerService } from '../common/logger.service';

@Module({
  imports: [PrismaModule, OrganizationsModule],
  controllers: [AdminController],
  providers: [AdminService, LoggerService],
  exports: [AdminService],
})
export class AdminModule {}
