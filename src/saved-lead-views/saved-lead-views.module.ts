import { Module } from '@nestjs/common';
import { SavedLeadViewsService } from './saved-lead-views.service';
import { SavedLeadViewsController } from './saved-lead-views.controller';

@Module({
  providers: [SavedLeadViewsService],
  controllers: [SavedLeadViewsController],
  exports: [SavedLeadViewsService],
})
export class SavedLeadViewsModule {}
