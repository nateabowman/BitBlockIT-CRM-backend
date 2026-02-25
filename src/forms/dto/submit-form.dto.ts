import { IsObject, IsOptional, IsString } from 'class-validator';

export class SubmitFormDto {
  @IsObject()
  data: Record<string, string>; // field key -> value

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  visitorId?: string;
}
