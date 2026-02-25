import { Module } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingController } from './tracking.controller';
import { TrackingPageEventController } from './tracking-page-event.controller';
import { TrackingPageEventService } from './tracking-page-event.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TrackingController, TrackingPageEventController],
  providers: [TrackingService, TrackingPageEventService],
  exports: [TrackingService, TrackingPageEventService],
})
export class TrackingModule {}
