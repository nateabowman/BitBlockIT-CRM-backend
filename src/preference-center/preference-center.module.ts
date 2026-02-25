import { Module } from '@nestjs/common';
import { PreferenceCenterController } from './preference-center.controller';
import { PreferenceCenterService } from './preference-center.service';

@Module({
  controllers: [PreferenceCenterController],
  providers: [PreferenceCenterService],
  exports: [PreferenceCenterService],
})
export class PreferenceCenterModule {}
