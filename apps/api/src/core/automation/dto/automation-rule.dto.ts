import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  AUTOMATION_EVENT_CATALOG,
  RULE_OPERATORS,
  type RuleMatch,
  type RuleOperator,
} from '@pulsar/shared';

const EVENT_TYPES = AUTOMATION_EVENT_CATALOG.map((e) => e.type);
const OPERATORS = RULE_OPERATORS.map((o) => o.operator);
const MATCHES: RuleMatch[] = ['ALL', 'ANY'];
const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
const ASSIGN_HINTS = ['AUTO', 'UNASSIGNED'] as const;

export class RuleConditionDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  field!: string;

  @ApiProperty({ enum: OPERATORS })
  @IsIn(OPERATORS)
  operator!: RuleOperator;

  // value is optional (exists/not_exists carry none); accept string | number | boolean.
  @ApiPropertyOptional()
  @IsOptional()
  value?: string | number | boolean;
}

export class RuleActionDto {
  @ApiProperty({ enum: ['CREATE_TASK', 'RUN_ACTION'] })
  @IsIn(['CREATE_TASK', 'RUN_ACTION'])
  kind!: 'CREATE_TASK' | 'RUN_ACTION';

  // CREATE_TASK fields — required when kind==='CREATE_TASK', validated in service.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  category?: string;

  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: (typeof SEVERITIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  titleTemplate?: string;

  @ApiPropertyOptional({ enum: ASSIGN_HINTS })
  @IsOptional()
  @IsIn(ASSIGN_HINTS)
  assignHint?: (typeof ASSIGN_HINTS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectField?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subjectType?: string;

  // RUN_ACTION fields — required when kind==='RUN_ACTION', validated in service.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  args?: Record<string, string>;
}

export class CreateAutomationRuleDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ enum: EVENT_TYPES })
  @IsIn(EVENT_TYPES)
  eventType!: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ enum: MATCHES })
  @IsIn(MATCHES)
  match!: RuleMatch;

  @ApiProperty({ type: [RuleConditionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleConditionDto)
  conditions!: RuleConditionDto[];

  @ApiProperty({ type: RuleActionDto })
  @ValidateNested()
  @Type(() => RuleActionDto)
  action!: RuleActionDto;
}

export class UpdateAutomationRuleDto extends PartialType(CreateAutomationRuleDto) {}
