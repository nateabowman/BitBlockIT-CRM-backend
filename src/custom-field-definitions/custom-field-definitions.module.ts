import { Module } from '@nestjs/common';
import { CustomFieldDefinitionsService } from './custom-field-definitions.service';
import { CustomFieldDefinitionsController } from './custom-field-definitions.controller';

@Module({
  providers: [CustomFieldDefinitionsService],
  controllers: [CustomFieldDefinitionsController],
  exports: [CustomFieldDefinitionsService],
})
export class CustomFieldDefinitionsModule {}
