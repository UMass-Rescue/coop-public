import { makeCapturingKysely } from '../../test/capturingKysely.js';
import { jsonStringify } from '../../utils/encoding.js';
import { type ReportingServicePg } from './dbTypes.js';
import { ReportingRuleSignalOperations } from './ReportingRuleSignalOperations.js';

const SIGNAL_VARS = jsonStringify({ signalType: 'IMAGE_CLIP_MATCH' });

function setup() {
  const { db, queries } = makeCapturingKysely<ReportingServicePg>();
  return { rules: new ReportingRuleSignalOperations(db), queries };
}

describe('ReportingRuleSignalOperations', () => {
  it('selects the org reporting rules in the given statuses that use the signal', async () => {
    const { rules, queries } = setup();

    await rules.getRulesUsingSignal({
      orgId: 'org-1',
      signalType: 'IMAGE_CLIP_MATCH',
      statuses: ['DRAFT'],
    });

    const [{ sql, parameters }] = queries;
    expect(sql).toContain('from "reporting_rules"."reporting_rules"');
    expect(sql).toContain('"org_id" = $1');
    expect(sql).toContain('"status" in ($2)');
    expect(sql).toContain('jsonb_path_exists("condition_set"');
    expect(sql).toContain('order by "name"');
    expect(parameters).toEqual(['org-1', 'DRAFT', SIGNAL_VARS]);
  });

  it('moves only the org Live and Background rules that use the signal to Draft', async () => {
    const { rules, queries } = setup();

    await rules.moveActiveRulesUsingSignalToDraft({
      orgId: 'org-1',
      signalType: 'IMAGE_CLIP_MATCH',
    });

    const [{ sql, parameters }] = queries;
    expect(sql).toContain('update "reporting_rules"."reporting_rules"');
    expect(sql).toContain('set "status" = $1');
    expect(sql).toContain('"org_id" = $2');
    expect(sql).toContain('"status" in ($3, $4)');
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
