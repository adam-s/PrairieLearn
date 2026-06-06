import fetch from 'node-fetch';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';

import { IdSchema } from '@prairielearn/zod';
import * as sqldb from '@prairielearn/postgres';

import { config } from '../lib/config.js';

import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

// Regression test for issue 1980: an issue whose variant_id is NULL (e.g. the variant
// was deleted) used to render a link ending in `variant_id=null` — an invalid URL. The
// variant query param must be omitted entirely when there is no variant.
describe('instructor issues page: link for an issue with no variant', { timeout: 20_000 }, () => {
  beforeAll(helperServer.before());
  afterAll(helperServer.after);

  it('omits the variant_id query param when the issue has no variant', async () => {
    const questionId = await sqldb.queryScalar(sql.select_question_id, IdSchema);
    await sqldb.execute(sql.insert_issue_without_variant, { question_id: questionId });

    const res = await fetch(
      `http://localhost:${config.serverPort}/pl/course/1/course_admin/issues?q=`,
    );
    assert.equal(res.status, 200);
    const html = await res.text();

    // The variant-less issue is listed…
    assert.include(html, 'variant-less issue (1980 repro)');
    // …and its link does NOT contain a broken `variant_id=null` query param.
    assert.notInclude(html, 'variant_id=null');
  });
});
