import { IsString, IsObject, IsOptional } from 'class-validator';

export class ImportLeadsDto {
  @IsString()
  pipelineId: string;

  @IsString()
  stageId: string;

  /** CSV rows as array of row objects (key = column name from header) */
  @IsObject({ each: true })
  rows: Record<string, string>[];

  /** Map field name to column key: { title: "Company", source: "Lead Source" } */
  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;
}
