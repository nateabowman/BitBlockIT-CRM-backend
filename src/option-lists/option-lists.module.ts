import { Module } from '@nestjs/common';
import { OptionListsService } from './option-lists.service';
import { OptionListsController } from './option-lists.controller';

@Module({
  providers: [OptionListsService],
  controllers: [OptionListsController],
  exports: [OptionListsService],
})
export class OptionListsModule {}
