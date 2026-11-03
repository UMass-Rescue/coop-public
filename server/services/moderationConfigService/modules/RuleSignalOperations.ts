import { sql, type ExpressionBuilder, type Kysely } from 'kysely';

import { conditionSetUsesSignal } from '../../../utils/conditionSetSignal.js';
import { type ModerationConfigServicePg } from '../dbTypes.js';
import { RuleStatus } from '../types/rules.js';

export type RuleUsingSignal = {
  id: string;
  name: string;
  status: RuleStatus;
};

/** Rules whose status means they are being evaluated on submitted items. */
const ACTIVE_STATUSES = [RuleStatus.LIVE, RuleStatus.BACKGROUND];

/** Rules past their expiration time are expired whatever their stored status. */
const notExpired = (
  eb: ExpressionBuilder<ModerationConfigServicePg, 'public.rules'>,
) =>
  eb.or([
    eb('expiration_time', 'is', null),
    eb('expiration_time', '>', sql<Date>`now()`),
  ]);

/**
 * Finds the rules that use a given signal, and moves the active ones to Draft.
 * Reads the primary, since the callers act on what they find straight away.
 */
export class RuleSignalOperations {
  constructor(private readonly pgQuery: Kysely<ModerationConfigServicePg>) {}

  async getRulesUsingSignal(opts: {
    orgId: string;
    signalType: string;
    statuses: readonly RuleStatus[];
  }): Promise<RuleUsingSignal[]> {
    const rows = await this.pgQuery
      .selectFrom('public.rules')
      .select(['id', 'name', 'status_if_unexpired'])
      .where('org_id', '=', opts.orgId)
      .where('status_if_unexpired', 'in', [...opts.statuses])
      .where(notExpired)
      .where(conditionSetUsesSignal('condition_set', opts.signalType))
      .orderBy('name')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status_if_unexpired,
    }));
  }

  /** Moves every Live or Background rule using the signal to Draft. */
  async moveActiveRulesUsingSignalToDraft(opts: {
    orgId: string;
    signalType: string;
  }): Promise<RuleUsingSignal[]> {
    const rows = await this.pgQuery
      .updateTable('public.rules')
      .set({ status_if_unexpired: RuleStatus.DRAFT })
      .where('org_id', '=', opts.orgId)
      .where('status_if_unexpired', 'in', ACTIVE_STATUSES)
      .where(notExpired)
      .where(conditionSetUsesSignal('condition_set', opts.signalType))
      .returning(['id', 'name'])
      .execute();

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: RuleStatus.DRAFT,
    }));
  }
}
