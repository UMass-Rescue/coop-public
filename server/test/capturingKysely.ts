import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';

export type CapturedQuery = { sql: string; parameters: readonly unknown[] };

/**
 * A Kysely instance that runs nothing and returns no rows, but records every
 * query it is asked to run, so a test can check the SQL that would be sent.
 */
export function makeCapturingKysely<DB>() {
  const queries: CapturedQuery[] = [];
  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      // eslint-disable-next-line functional/immutable-data -- a test recorder
      queries.push({
        sql: event.query.sql,
        parameters: event.query.parameters,
      });
    },
  });
  return { db, queries };
}
