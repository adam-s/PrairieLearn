import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import { z } from 'zod';

import { IdSchema } from '@prairielearn/zod';
import * as sqldb from '@prairielearn/postgres';

import { run } from '../cron/calculateAssessmentQuestionStats.js';

import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

describe('calculateAssessmentQuestionStats cron', { timeout: 60_000 }, () => {
  beforeAll(helperServer.before());
  afterAll(helperServer.after);

  // Regression test for issue 2238: an assessment whose stats were never calculated
  // (stats_last_updated IS NULL) must still be picked up and recalculated. The recalc
  // gate compared `ai.modified_at > a.stats_last_updated`, which is NULL (never true)
  // when stats_last_updated is NULL, so such assessments were skipped forever.
  it('recalculates an assessment whose stats were never calculated', async () => {
    const { assessment_id, user_id } = await sqldb.queryRow(
      sql.select_assessment_and_user,
      {},
      z.object({ assessment_id: IdSchema, user_id: IdSchema }),
    );

    // An attempt exists (so modified_at is set), but stats have never been computed.
    await sqldb.execute(sql.insert_assessment_instance, { assessment_id, user_id });
    await sqldb.execute(sql.null_stats_last_updated, { assessment_id });

    await run();

    // The cron should have selected and recalculated it, stamping stats_last_updated.
    const { recalculated } = await sqldb.queryRow(
      sql.select_stats_recalculated,
      { assessment_id },
      z.object({ recalculated: z.boolean() }),
    );
    assert.isTrue(recalculated);
  });
});
