import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { afterAll, assert, beforeAll, describe, test } from 'vitest';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { config } from '../lib/config.js';

import { fetchCheerio } from './helperClient.js';
import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const siteUrl = 'http://localhost:' + config.serverPort;
const baseUrl = siteUrl + '/pl';
const courseInstanceIssuesUrl = baseUrl + '/course_instance/1/instructor/course_admin/issues';
const courseIssuesUrl = baseUrl + '/course/1/course_admin/issues';

describe('Issues', { timeout: 15_000 }, function () {
  beforeAll(helperServer.before());

  afterAll(helperServer.after);

  doTest(courseInstanceIssuesUrl, 'course');
  doTest(courseIssuesUrl, 'course instance');

  // Regression test for an issue tied to a deleted assessment.
  //
  // When an assessment is deleted, the issue's assessment_id FK still points at
  // it (soft-delete does not null it), and the assessment's set is removed (its
  // assessment_set_id becomes NULL). The Issues query then produces a null
  // label/color for that assessment; previously the non-nullable row schema
  // rejected this and the whole Issues page returned a 500 (ZodError). It must
  // instead render, showing the issue with an "Unknown assessment" badge.
  describe('Issue associated with a deleted assessment', () => {
    test.sequential('Issues page renders instead of crashing', async () => {
      // Report an issue from the question preview so we have a course-caused issue.
      const questionId = await sqldb.queryScalar(sql.select_question_id, IdSchema);
      const questionUrl = `${baseUrl}/course_instance/1/instructor/question/${questionId}/preview`;
      let res = await fetch(questionUrl);
      const $ = cheerio.load(await res.text());
      const csrfToken = $('div[id="issueCollapse"] input[name="__csrf_token"]')
        .first()
        .attr('value');
      assert(typeof csrfToken === 'string');
      const variantId = $('div[id="issueCollapse"] input[name="__variant_id"]')
        .first()
        .attr('value');
      assert(typeof variantId === 'string');

      res = await fetch(questionUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'report_issue',
          __csrf_token: csrfToken,
          __variant_id: variantId,
          description: 'deleted assessment issue',
        }),
      });
      assert.equal(res.status, 200);

      const issueId = await sqldb.queryScalar(sql.select_latest_issue, IdSchema);

      // Attach the issue to a real (live) assessment.
      const assessmentId = await sqldb.queryScalar(sql.select_assessment_with_set, IdSchema);
      await sqldb.execute(sql.attach_issue_to_assessment, {
        issue_id: issueId,
        assessment_id: assessmentId,
      });

      // Sanity check (sibling input): while the assessment still exists, the
      // issue shows a real assessment badge — NOT the "Unknown assessment"
      // fallback. This confirms the fix only changes the deleted-assessment case.
      {
        const pageRes = await fetchCheerio(courseIssuesUrl);
        assert.equal(pageRes.status, 200);
        const itemText = pageRes.$('[data-testid="issue-list-item"]').text();
        assert.notInclude(itemText, 'Unknown assessment');
      }

      // Now soft-delete that assessment and clear its set — the exact state that
      // broke the page (null label/color for a still-referenced assessment).
      await sqldb.execute(sql.soft_delete_assessment_and_clear_set, {
        assessment_id: assessmentId,
      });

      // The Issues page must now load (was a 500 before the fix) and show the
      // issue with an "Unknown assessment" badge rather than a real assessment
      // link.
      for (const url of [courseIssuesUrl, courseInstanceIssuesUrl]) {
        const pageRes = await fetchCheerio(url);
        assert.equal(pageRes.status, 200, `Issues page should render (${url})`);
        assert.lengthOf(
          pageRes.$('[data-testid="issue-list-item"]'),
          1,
          `the deleted-assessment issue should still be listed (${url})`,
        );
        assert.include(
          pageRes.$('[data-testid="issue-list-item"]').text(),
          'Unknown assessment',
          `the deleted assessment should show as "Unknown assessment" (${url})`,
        );
      }
    });
  });
});

function doTest(issuesUrl: string, label: string) {
  describe(`Report issue with question and close all issues in ${label}`, () => {
    let questionUrl;

    test.sequential('should report issues to a question', async () => {
      const questionId = await sqldb.queryScalar(sql.select_question_id, IdSchema);
      questionUrl = `${baseUrl}/course_instance/1/instructor/question/${questionId}/preview`;
      let res = await fetch(questionUrl);
      const $ = cheerio.load(await res.text());

      const csrfToken = $('div[id="issueCollapse"] input[name="__csrf_token"]')
        .first()
        .attr('value');
      assert(typeof csrfToken === 'string');

      const variantId = $('div[id="issueCollapse"] input[name="__variant_id"]')
        .first()
        .attr('value');
      assert(typeof variantId === 'string');

      // We'll report three issues total so that we have a variety to close.
      // We give them distinct descriptions to test that "close matching" works.

      res = await fetch(questionUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'report_issue',
          __csrf_token: csrfToken,
          __variant_id: variantId,
          description: 'mountain breeze crisp',
        }),
      });
      assert.equal(res.status, 200);

      res = await fetch(questionUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'report_issue',
          __csrf_token: csrfToken,
          __variant_id: variantId,
          description: 'velvet sunset glow',
        }),
      });
      assert.equal(res.status, 200);

      res = await fetch(questionUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'report_issue',
          __csrf_token: csrfToken,
          __variant_id: variantId,
          description: 'whispering river serenade',
        }),
      });
      assert.equal(res.status, 200);

      const rowCount = await sqldb.execute(sql.select_open_issues);
      assert.equal(rowCount, 3, 'Expected three open issues');
    });

    test.sequential('should close issues matching a query', async () => {
      const issuesUrlWithQuery = `${issuesUrl}?q=is%3Aopen+mountain`;
      let res = await fetch(issuesUrlWithQuery);
      const $ = cheerio.load(await res.text());

      const csrfToken = $('div#closeMatchingIssuesModal input[name="__csrf_token"]')
        .first()
        .attr('value');
      assert(typeof csrfToken === 'string');

      const issueIds = $('div#closeMatchingIssuesModal input[name="unsafe_issue_ids"]')
        .first()
        .attr('value');
      assert(typeof issueIds === 'string');

      res = await fetch(issuesUrlWithQuery, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'close_matching',
          __csrf_token: csrfToken,
          unsafe_issue_ids: issueIds,
        }),
      });
      assert.equal(res.status, 200);

      const rowCount = await sqldb.execute(sql.select_open_issues);
      assert.equal(rowCount, 2, 'Expected two open issues');
    });

    test.sequential('should close all open issues', async () => {
      let res = await fetch(issuesUrl);
      const $ = cheerio.load(await res.text());

      const csrfToken = $('div#closeMatchingIssuesModal input[name="__csrf_token"]')
        .first()
        .attr('value');
      assert(typeof csrfToken === 'string');

      const issueIds = $('div#closeMatchingIssuesModal input[name="unsafe_issue_ids"]')
        .first()
        .attr('value');
      assert(typeof issueIds === 'string');

      res = await fetch(issuesUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: 'close_matching',
          __csrf_token: csrfToken,
          unsafe_issue_ids: issueIds,
        }),
      });
      assert.equal(res.status, 200);

      const rowCount = await sqldb.execute(sql.select_open_issues);
      assert.equal(rowCount, 0, 'Expected zero open issues');
    });
  });
}
