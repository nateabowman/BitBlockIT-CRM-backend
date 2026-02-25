import { IsString } from 'class-validator';

export class PromoteToDealDto {
  @IsString()
  pipelineId: string;
}
