import { makeCapturingKysely } from '../../../test/capturingKysely.js';
import { jsonStringify } from '../../../utils/encoding.js';
import { type ModerationConfigServicePg } from '../dbTypes.js';
import { RuleStatus } from '../types/rules.js';
import { RuleSignalOperations } from './RuleSignalOperations.js';

const SIGNAL_VARS = jsonStringify({ signalType: 'IMAGE_CLIP_MATCH' });

function setup() {
  const { db, queries } = makeCapturingKysely<ModerationConfigServicePg>();
  return { ops: new RuleSignalOperations(db), queries };
}

describe('RuleSignalOperations', () => {
  describe('getRulesUsingSignal', () => {
    it('selects the org rules in the given statuses that use the signal, by name', async () => {
      const { ops, queries } = setup();

      await ops.getRulesUsingSignal({
        orgId: 'org-1',
        signalType: 'IMAGE_CLIP_MATCH',
        statuses: [RuleStatus.DRAFT],
      });

      const [{ sql, parameters }] = queries;
      expect(sql).toContain('from "public"."rules"');
      expect(sql).toContain('"org_id" = $1');
      expect(sql).toContain('"status_if_unexpired" in ($2)');
      expect(sql).toContain(
        '("expiration_time" is null or "expiration_time" > now())',
      );
      expect(sql).toContain('jsonb_path_exists("condition_set"');
      expect(sql).toContain('(@.signal.type == $signalType)');
      expect(sql).toContain('order by "name"');
      expect(parameters).toEqual(['org-1', 'DRAFT', SIGNAL_VARS]);
    });

    it('passes the signal type as a variable, never in the query text', async () => {
      const { ops, queries } = setup();

      await ops.getRulesUsingSignal({
        orgId: 'org-1',
        signalType: `X") or true --`,
        statuses: [RuleStatus.LIVE],
      });

      expect(queries[0].sql).not.toContain('or true');
      expect(queries[0].parameters).toContain(
        jsonStringify({ signalType: `X") or true --` }),
      );
    });
  });

  describe('moveActiveRulesUsingSignalToDraft', () => {
    it('moves only the org Live and Background rules that use the signal', async () => {
      const { ops, queries } = setup();

      await ops.moveActiveRulesUsingSignalToDraft({
        orgId: 'org-1',
        signalType: 'IMAGE_CLIP_MATCH',
      });

      const [{ sql, parameters }] = queries;
      expect(sql).toContain('update "public"."rules"');
      expect(sql).toContain('set "status_if_unexpired" = $1');
      expect(sql).toContain('"org_id" = $2');
      expect(sql).toContain('"status_if_unexpired" in ($3, $4)');
      expect(sql).toContain(
        '("expiration_time" is null or "expiration_time" > now())',
      );
      expect(sql).toContain('jsonb_path_exists("condition_set"');
      expect(sql).toContain('returning "id", "name"');
      expect(parameters).toEqual([
        'DRAFT',
        'org-1',
        'LIVE',
        'BACKGROUND',
        SIGNAL_VARS,
      ]);
    });
  });
});
