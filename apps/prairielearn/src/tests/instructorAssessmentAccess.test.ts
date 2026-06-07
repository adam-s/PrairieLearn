import { afterAll, assert, beforeAll, describe, test } from 'vitest';

import { config } from '../lib/config.js';
import { selectAssessmentByTid } from '../models/assessment.js';

import { fetchCheerio } from './helperClient.js';
import * as helperServer from './helperServer.js';

const siteUrl = `http://localhost:${config.serverPort}`;

// Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/2334:
// the instructor Access page's access-rules table omitted the showClosedAssessment
// (and showClosedAssessmentScore) settings, so staff could not see them.
//
// testCourse's `exam11-activeAccessRestriction` has access rules that set both
// flags to false, so the rendered table must show those settings.
describe('instructorAssessmentAccess: showClosedAssessment columns', { timeout: 60_000 }, () => {
  let accessUrl: string;

  beforeAll(async () => {
    await helperServer.before()();
    const { id: assessmentId } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'exam11-activeAccessRestriction',
    });
    accessUrl = `${siteUrl}/pl/course_instance/1/instructor/assessment/${assessmentId}/access`;
  });

  afterAll(helperServer.after);

  test('access-rules table renders the closed-assessment columns and values', async () => {
    const res = await fetchCheerio(accessUrl);
    assert.equal(res.status, 200);

    const table = res.$('table[aria-label="Access rules"]');
    assert.lengthOf(table, 1, 'access-rules table should be present');

    const headers = table
      .find('thead th')
      .map((_, el) => res.$(el).text().trim())
      .get();
    assert.include(
      headers,
      'Show closed assessment',
      'table should have a "Show closed assessment" column',
    );
    assert.include(
      headers,
      'Show closed assessment score',
      'table should have a "Show closed assessment score" column',
    );

    // The flags are booleans (not null, default true), rendered as True/False like
    // the sibling "Active" column. exam11 has a rule with showClosedAssessment:false
    // and showClosedAssessmentScore:false, and rules that leave them at the default.
    const showClosedIdx = headers.indexOf('Show closed assessment');
    const showClosedScoreIdx = headers.indexOf('Show closed assessment score');

    const cellsAt = (idx: number) =>
      table
        .find('tbody tr')
        .map((_, tr) => res.$(tr).find('td').eq(idx).text().trim())
        .get();

    const showClosedValues = cellsAt(showClosedIdx);
    const showClosedScoreValues = cellsAt(showClosedScoreIdx);

    // Every cell is a rendered boolean.
    assert.isTrue(
      showClosedValues.every((v) => v === 'True' || v === 'False'),
      `showClosedAssessment cells should all be True/False, got ${JSON.stringify(showClosedValues)}`,
    );
    assert.isTrue(
      showClosedScoreValues.every((v) => v === 'True' || v === 'False'),
      `showClosedAssessmentScore cells should all be True/False, got ${JSON.stringify(showClosedScoreValues)}`,
    );

    // The configured rule must surface as False in both columns; default rules as True.
    assert.include(showClosedValues, 'False', 'a rule sets showClosedAssessment:false');
    assert.include(showClosedValues, 'True', 'a rule leaves showClosedAssessment at the default');
    assert.include(showClosedScoreValues, 'False', 'a rule sets showClosedAssessmentScore:false');
  });
});
