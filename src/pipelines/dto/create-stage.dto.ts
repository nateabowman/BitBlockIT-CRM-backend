import { IsString, IsOptional, IsBoolean, IsInt } from 'class-validator';

export class CreateStageDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsInt()
  order?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  isWon?: boolean;

  @IsOptional()
  @IsBoolean()
  isLost?: boolean;
}
