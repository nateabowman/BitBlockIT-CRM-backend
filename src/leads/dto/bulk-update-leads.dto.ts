import { IsArray, IsString, IsOptional, ArrayMinSize } from 'class-validator';

export class BulkUpdateLeadsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  leadIds: string[];

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsOptional()
  @IsString()
  stageId?: string;
}
