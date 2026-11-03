import { type Kysely } from 'kysely';

import { conditionSetUsesSignal } from '../../utils/conditionSetSignal.js';
import { type ReportingServicePg } from './dbTypes.js';
import { ReportingRuleStatus } from './ReportingRules.js';

/**
 * Finds the reporting rules that use a given signal, and moves the active ones
 * to Draft. Reads the primary, since callers act on what they find straight
 * away.
 */
export class ReportingRuleSignalOperations {
  constructor(private readonly pgQuery: Kysely<ReportingServicePg>) {}

  /** The org's reporting rules in the given statuses that use a signal. */
  async getRulesUsingSignal(opts: {
    orgId: string;
    signalType: string;
    statuses: readonly ReportingRuleStatus[];
  }) {
    return this.pgQuery
      .selectFrom('reporting_rules.reporting_rules')
      .select(['id', 'name', 'status'])
      .where('org_id', '=', opts.orgId)
      .where('status', 'in', [...opts.statuses])
      .where(conditionSetUsesSignal('condition_set', opts.signalType))
      .orderBy('name')
      .execute();
  }

  /** Moves every Live or Background rule using the signal to Draft. */
  async moveActiveRulesUsingSignalToDraft(opts: {
    orgId: string;
    signalType: string;
  }) {
    return this.pgQuery
      .updateTable('reporting_rules.reporting_rules')
      .set({ status: ReportingRuleStatus.DRAFT })
      .where('org_id', '=', opts.orgId)
      .where('status', 'in', [
        ReportingRuleStatus.LIVE,
        ReportingRuleStatus.BACKGROUND,
      ])
      .where(conditionSetUsesSignal('condition_set', opts.signalType))
      .returning(['id', 'name'])
      .execute();
  }
}
