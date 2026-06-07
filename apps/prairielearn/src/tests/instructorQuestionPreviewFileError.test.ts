import type { CheerioAPI } from 'cheerio';
import { afterAll, assert, beforeAll, describe, test } from 'vitest';

import { config } from '../lib/config.js';
import { type Question } from '../lib/db-types.js';
import { selectQuestionByQid } from '../models/question.js';

import { fetchCheerio } from './helperClient.js';
import * as helperServer from './helperServer.js';

const siteUrl = 'http://localhost:' + config.serverPort;

function getVariantId($: CheerioAPI): string {
  const variantId = $('.question-container').attr('data-variant-id');
  assert.isString(variantId);
  return variantId as string;
}

// Regression test for https://github.com/PrairieLearn/PrairieLearn/issues/805
//
// A question whose `file()` raises records a course issue, but only against the
// variant whose dynamic file was actually requested. The instructor question
// preview page used to generate a NEW variant on every load that lacked a
// `variant_id`, so a refresh never re-showed the variant that had the error —
// the error was invisible.
//
// The fix makes a `variant_id`-less GET redirect to the same page with a pinned
// `variant_id`, so refreshing re-shows the same variant (and its file() error).
//
// testCourse ships `questions/brokenDynamicFile` whose `file()` always raises.
describe('instructor question preview surfaces file() errors across refresh (issue 805)', () => {
  beforeAll(helperServer.before());
  afterAll(helperServer.after);

  let question: Question;
  let previewBaseUrl: string;

  beforeAll(async () => {
    question = await selectQuestionByQid({ course_id: '1', qid: 'brokenDynamicFile' });
    previewBaseUrl = `${siteUrl}/pl/course/1/question/${question.id}/preview`;
  });

  test.sequential(
    'a variant_id-less preview redirects to a pinned variant_id',
    async () => {
      const res = await fetchCheerio(previewBaseUrl);
      assert.equal(res.status, 200);
      // node-fetch follows the redirect; the final URL must carry variant_id.
      assert.match(res.url, /[?&]variant_id=\d+/, 'preview should redirect with variant_id pinned');
      // The pinned variant_id in the URL matches the rendered variant.
      const urlVariantId = new URL(res.url).searchParams.get('variant_id');
      assert.equal(getVariantId(res.$), urlVariantId);
    },
  );

  test.sequential(
    'refreshing the preview re-shows the same variant with the file() error',
    async () => {
      // 1. Fresh load of the bare preview path. With the fix this redirects to
      //    a pinned ?variant_id=V1; `landedUrl` is what the browser address bar
      //    ends up showing (what a refresh re-requests). On the base code there
      //    is no redirect, so `landedUrl` stays the bare path.
      const res1 = await fetchCheerio(previewBaseUrl);
      assert.equal(res1.status, 200);
      const landedUrl = res1.url;
      const variantId1 = getVariantId(res1.$);

      // No error is shown yet: file() hasn't been requested for V1.
      assert.notMatch(res1.$.root().text(), /Error creating file/);

      // 2. Request the dynamic file for V1 → file() raises → course issue
      //    recorded against V1 (writeCourseIssues in getDynamicFile). The route
      //    response body/status isn't the signal here; the recorded issue is.
      await fetch(
        `${siteUrl}/pl/course/1/question/${question.id}/generatedFilesQuestion/variant/${variantId1}/file.txt`,
      );

      // 3. Refresh = re-request the URL the browser actually landed on.
      //    With the fix this is the pinned ?variant_id=V1, so the SAME variant
      //    (and its recorded error) is re-shown. On the base code `landedUrl`
      //    is the bare path, so a new variant is generated and the error is
      //    never seen — this assertion fails on base, passes with the fix.
      const res2 = await fetchCheerio(landedUrl);
      assert.equal(res2.status, 200);
      const variantId2 = getVariantId(res2.$);

      // The core of the fix: refresh preserves the variant.
      assert.equal(variantId2, variantId1, 'refresh must re-show the same variant');

      // And the file() error is now surfaced on the preview page.
      assert.match(
        res2.$.root().text(),
        /Error creating file/,
        'the file() error must be visible on the refreshed preview',
      );
    },
  );

  test.sequential('an explicit variant_id is shown as-is (not redirected away)', async () => {
    // Create a variant via the pinned redirect, then re-request it explicitly.
    const seed = await fetchCheerio(previewBaseUrl);
    const variantId = getVariantId(seed.$);
    const res = await fetchCheerio(`${previewBaseUrl}?variant_id=${variantId}`);
    assert.equal(res.status, 200);
    // No further redirect; same variant rendered.
    assert.equal(getVariantId(res.$), variantId);
  });
});
