import { IsString, IsEmail, IsOptional } from 'class-validator';

export class SendEmailDto {
  @IsString()
  templateId: string;

  @IsOptional()
  @IsEmail()
  toEmail?: string;
}
