import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AutomationTrigger =
  | 'lead_created'
  | 'lead_stage_changed'
  | 'lead_score_threshold'
  | 'lead_assigned'
  | 'activity_completed'
  | 'form_submitted'
  | 'deal_won'
  | 'deal_lost'
  | 'no_activity_days';

export type AutomationActionType =
  | 'add_tag'
  | 'remove_tag'
  | 'assign_user'
  | 'change_stage'
  | 'create_activity'
  | 'send_email'
  | 'send_webhook'
  | 'update_field'
  | 'notify_slack';

export interface AutomationRule {
  id: string;
  name: string;
  isActive: boolean;
  trigger: AutomationTrigger;
  triggerConfig: Record<string, unknown>;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
  executionCount: number;
  lastExecutedAt?: string;
}

export interface AutomationCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'not_contains' | 'in' | 'not_in';
  value: unknown;
}

export interface AutomationAction {
  type: AutomationActionType;
  config: Record<string, unknown>;
}

@Injectable()
export class AutomationService {
  constructor(private prisma: PrismaService) {}

  /** Store automations in global settings (JSON) until a dedicated table is added */
  private async getStore(): Promise<AutomationRule[]> {
    const setting = await this.prisma.optionList.findFirst({
      where: { type: '_automation_rules', value: '_store' },
    });
    if (!setting || !setting.label) return [];
    try {
      return JSON.parse(setting.label) as AutomationRule[];
    } catch {
      return [];
    }
  }

  private async saveStore(rules: AutomationRule[]) {
    await this.prisma.optionList.upsert({
      where: { type__value: { type: '_automation_rules', value: '_store' } },
      update: { label: JSON.stringify(rules) },
      create: { type: '_automation_rules', value: '_store', label: JSON.stringify(rules), order: 0 },
    });
  }

  async findAll() {
    return this.getStore();
  }

  async findOne(id: string) {
    const rules = await this.getStore();
    const rule = rules.find((r) => r.id === id);
    if (!rule) throw new NotFoundException(`Automation rule ${id} not found`);
    return rule;
  }

  async create(dto: Omit<AutomationRule, 'id' | 'createdAt' | 'updatedAt' | 'executionCount' | 'lastExecutedAt'>) {
    const rules = await this.getStore();
    const rule: AutomationRule = {
      ...dto,
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      executionCount: 0,
    };
    await this.saveStore([...rules, rule]);
    return rule;
  }

  async update(id: string, dto: Partial<AutomationRule>) {
    const rules = await this.getStore();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) throw new NotFoundException(`Automation rule ${id} not found`);
    const updated = { ...rules[idx], ...dto, id, updatedAt: new Date().toISOString() };
    rules[idx] = updated;
    await this.saveStore(rules);
    return updated;
  }

  async remove(id: string) {
    const rules = await this.getStore();
    const filtered = rules.filter((r) => r.id !== id);
    await this.saveStore(filtered);
    return { message: 'Automation deleted' };
  }

  async toggle(id: string) {
    const rules = await this.getStore();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx === -1) throw new NotFoundException(`Automation rule ${id} not found`);
    rules[idx].isActive = !rules[idx].isActive;
    rules[idx].updatedAt = new Date().toISOString();
    await this.saveStore(rules);
    return rules[idx];
  }

  /**
   * Evaluate automations for a given trigger event.
   * Executes matching actions and logs results.
   */
  async evaluate(trigger: AutomationTrigger, context: Record<string, unknown>) {
    const rules = await this.getStore();
    const matching = rules.filter((r) => r.isActive && r.trigger === trigger);
    const results: { ruleId: string; ruleName: string; actionsExecuted: number }[] = [];

    for (const rule of matching) {
      let conditionsMet = true;
      for (const condition of rule.conditions ?? []) {
        const val = context[condition.field];
        conditionsMet = this.evaluateCondition(val, condition.operator, condition.value);
        if (!conditionsMet) break;
      }
      if (!conditionsMet) continue;
      let actionsExecuted = 0;
      for (const action of rule.actions ?? []) {
        try {
          await this.executeAction(action, context);
          actionsExecuted++;
        } catch {
          // Log failure but continue
        }
      }
      rule.executionCount = (rule.executionCount ?? 0) + 1;
      rule.lastExecutedAt = new Date().toISOString();
      results.push({ ruleId: rule.id, ruleName: rule.name, actionsExecuted });
    }
    if (matching.length > 0) await this.saveStore(rules);
    return results;
  }

  private evaluateCondition(value: unknown, operator: AutomationCondition['operator'], expected: unknown): boolean {
    switch (operator) {
      case 'eq': return value === expected;
      case 'neq': return value !== expected;
      case 'gt': return typeof value === 'number' && typeof expected === 'number' && value > expected;
      case 'lt': return typeof value === 'number' && typeof expected === 'number' && value < expected;
      case 'contains': return typeof value === 'string' && typeof expected === 'string' && value.includes(expected);
      case 'not_contains': return !(typeof value === 'string' && typeof expected === 'string' && value.includes(expected));
      case 'in': return Array.isArray(expected) && expected.includes(value);
      case 'not_in': return Array.isArray(expected) && !expected.includes(value);
      default: return false;
    }
  }

  private async executeAction(action: AutomationAction, context: Record<string, unknown>) {
    const leadId = context.leadId as string | undefined;
    switch (action.type) {
      case 'add_tag': {
        if (!leadId) return;
        const tagName = action.config.tagName as string;
        let tag = await this.prisma.tag.findUnique({ where: { name: tagName } });
        if (!tag) tag = await this.prisma.tag.create({ data: { name: tagName } });
        await this.prisma.leadTag.upsert({
          where: { leadId_tagId: { leadId, tagId: tag.id } },
          update: {},
          create: { leadId, tagId: tag.id },
        });
        break;
      }
      case 'remove_tag': {
        if (!leadId) return;
        const tagName = action.config.tagName as string;
        const tag = await this.prisma.tag.findUnique({ where: { name: tagName } });
        if (tag) await this.prisma.leadTag.deleteMany({ where: { leadId, tagId: tag.id } });
        break;
      }
      case 'assign_user': {
        if (!leadId) return;
        const assignedToId = action.config.userId as string;
        await this.prisma.lead.update({ where: { id: leadId }, data: { assignedToId } });
        break;
      }
      case 'change_stage': {
        if (!leadId) return;
        const stageId = action.config.stageId as string;
        await this.prisma.lead.update({ where: { id: leadId }, data: { currentStageId: stageId } });
        break;
      }
      case 'update_field': {
        if (!leadId) return;
        const field = action.config.field as string;
        const value = action.config.value;
        if (['nextStep', 'status', 'lostReason'].includes(field)) {
          await this.prisma.lead.update({ where: { id: leadId }, data: { [field]: value } });
        } else {
          const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { customFields: true } });
          const cf = (lead?.customFields as Record<string, unknown> | null) ?? {};
          await this.prisma.lead.update({ where: { id: leadId }, data: { customFields: { ...cf, [field]: value } } });
        }
        break;
      }
      case 'create_activity': {
        if (!leadId) return;
        const userId = context.userId as string | undefined;
        if (!userId) return;
        const daysOffset = (action.config.daysFromNow as number | undefined) ?? 0;
        const scheduledAt = new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000);
        await this.prisma.activity.create({
          data: {
            leadId,
            userId,
            type: (action.config.activityType as string) ?? 'task',
            subject: action.config.subject as string | undefined,
            body: action.config.body as string | undefined,
            scheduledAt: daysOffset > 0 ? scheduledAt : null,
          },
        });
        break;
      }
      case 'send_webhook': {
        const url = action.config.url as string;
        if (!url) return;
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: context.trigger, leadId, context }),
        }).catch(() => {});
        break;
      }
      default:
        break;
    }
  }
}
