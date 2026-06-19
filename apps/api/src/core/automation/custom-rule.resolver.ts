import { Injectable, Logger } from '@nestjs/common';
import {
  evaluateRuleConditions,
  produceRuleTaskSpec,
  type AutomationRuleLike,
  type RuleAction,
  type RuleCondition,
  type RuleMatch,
  type TaskSpec,
} from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Consults tenant-configured AutomationRules for a domain event and produces
 * TaskSpecs to be merged with the hard-coded policy specs at the single
 * integration point (DomainEventsService.processPending).
 *
 * Best-effort by design (CLAUDE.md rule 24): a single bad rule must never drop
 * the others, and a top-level failure must never break built-in task creation.
 */
@Injectable()
export class CustomRuleResolver {
  private readonly logger = new Logger(CustomRuleResolver.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    tenantId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<TaskSpec[]> {
    const specs: TaskSpec[] = [];
    try {
      const rules = await this.prisma.automationRule.findMany({
        where: { tenantId, eventType, enabled: true },
      });

      for (const rule of rules) {
        try {
          const conditions = (rule.conditions ?? []) as unknown as RuleCondition[];
          const action = rule.action as unknown as RuleAction;
          const match = rule.match as RuleMatch;

          if (!evaluateRuleConditions(conditions, match, payload)) continue;

          const ruleLike: AutomationRuleLike = {
            id: rule.id,
            eventType: rule.eventType,
            match,
            conditions,
            action,
          };
          const spec = produceRuleTaskSpec(ruleLike, { type: eventType, payload });
          if (spec) specs.push(spec);
        } catch (err) {
          // One bad rule must not drop the others — log and continue.
          this.logger.error(
            `automation rule ${rule.id} failed for event ${eventType}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      // Top-level failure (e.g. DB) must never break built-in task creation.
      this.logger.error(
        `CustomRuleResolver.resolve(${eventType}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    return specs;
  }
}
