import { makeCapturingKysely } from '../../../test/capturingKysely.js';
import { jsonStringify } from '../../../utils/encoding.js';
import { type ManualReviewToolServicePg } from '../dbTypes.js';
import JobRouting from './JobRouting.js';

describe('JobRouting.getRoutingRulesUsingSignal', () => {
  it('selects the org routing rules that use the signal, by name, and changes nothing', async () => {
    const { db, queries } = makeCapturingKysely<ManualReviewToolServicePg>();
    // The routing rule query uses only the database.
    const routing = new JobRouting(
      db,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await routing.getRoutingRulesUsingSignal({
      orgId: 'org-1',
      signalType: 'IMAGE_CLIP_MATCH',
    });

    expect(queries).toHaveLength(1);
    const [{ sql, parameters }] = queries;
    expect(sql).toMatch(/^select /);
    expect(sql).toContain('from "manual_review_tool"."routing_rules"');
    expect(sql).toContain('"org_id" = $1');
    expect(sql).toContain('jsonb_path_exists("condition_set"');
    expect(sql).toContain('order by "name"');
    expect(parameters).toEqual([
      'org-1',
      jsonStringify({ signalType: 'IMAGE_CLIP_MATCH' }),
    ]);
  });
});
