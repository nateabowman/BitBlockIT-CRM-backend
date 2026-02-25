import { Module } from '@nestjs/common';
import { SalesPlaybooksService } from './sales-playbooks.service';
import { SalesPlaybooksController } from './sales-playbooks.controller';

@Module({
  providers: [SalesPlaybooksService],
  controllers: [SalesPlaybooksController],
  exports: [SalesPlaybooksService],
})
export class SalesPlaybooksModule {}
