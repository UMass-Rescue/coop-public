import { sql, type RawBuilder } from 'kysely';

import { jsonStringify } from './encoding.js';

/**
 * SQL that is true when the condition set stored in `conditionSetColumn` uses
 * the signal of type `signalType` in any condition, including conditions inside
 * nested condition sets. The signal type is passed as a JSON path variable, not
 * spliced into the query.
 */
export function conditionSetUsesSignal(
  conditionSetColumn: string,
  signalType: string,
): RawBuilder<boolean> {
  return sql<boolean>`jsonb_path_exists(${sql.ref(conditionSetColumn)}, '$.** ? (@.signal.type == $signalType)', ${jsonStringify({ signalType })}::jsonb)`;
}
