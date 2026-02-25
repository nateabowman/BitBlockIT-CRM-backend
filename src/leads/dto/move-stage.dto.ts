import { IsString, IsOptional } from 'class-validator';

export class MoveStageDto {
  @IsString()
  stageId: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
