import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { config } from '../lib/config.js';
import { features } from '../lib/features/index.js';
import { updateCourseSharingName } from '../models/course.js';

import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const siteUrl = 'http://localhost:' + config.serverPort;
const baseUrl = siteUrl + '/pl';

// The public questions listing page for the test course (course_id 1). This is
// the public-facing counterpart of the instructor `course_admin/questions` page
// covered by `instructorQuestions.test.ts`.
const publicQuestionsUrl = baseUrl + '/public/course/1/questions';

// A question shared with `share_publicly` (content public + importable).
const publiclyShared = {
  id: '',
  qid: 'addNumbers',
  title: 'Add two numbers',
};
// A question shared with `share_source_publicly` (source viewable, not importable).
const sourceShared = {
  id: '',
  qid: 'addVectors',
  title: 'Addition of vectors in Cartesian coordinates',
};
// A question that is not shared at all; it must never appear on the public page.
// Its `info.json` declares no sharing (neither `sharePublicly` nor
// `shareSourcePublicly` nor a sharing set), and the seed below never opts it in,
// so it is the negative control for the public filter.
const notShared = {
  id: '',
  qid: 'downloadFile',
  title: 'File download example question',
};
const testQuestions = [publiclyShared, sourceShared, notShared];

describe('Public questions page', { timeout: 60_000 }, function () {
  beforeAll(helperServer.before());

  afterAll(helperServer.after);

  beforeAll(async () => {
    await features.enable('question-sharing');
  });

  beforeAll(async () => {
    for (const testQuestion of testQuestions) {
      testQuestion.id = await sqldb.queryScalar(
        sql.select_question_id,
        { qid: testQuestion.qid },
        z.string(),
      );
    }
  });

  beforeAll(async () => {
    // A sharing name is required for a non-example course to expose its public
    // questions page; without it the page renders a "Missing sharing name" card.
    await updateCourseSharingName({ course_id: '1', sharing_name: 'test-course' });
  });

  beforeAll(async () => {
    // Questions default to unshared (both flags FALSE), so we only need to opt
    // the two shared questions in. `notShared` is intentionally left unshared.
    await sqldb.execute(sql.update_share_publicly, { question_id: publiclyShared.id });
    await sqldb.execute(sql.update_share_source_publicly, { question_id: sourceShared.id });
  });

  describe('GET ' + publicQuestionsUrl, () => {
    it('loads successfully', async () => {
      const res = await fetch(publicQuestionsUrl);
      assert.equal(res.status, 200);
    });

    it('lists a publicly shared question', async () => {
      const res = await fetch(publicQuestionsUrl);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.include(text, publiclyShared.qid);
      assert.include(text, publiclyShared.title);
    });

    it('lists a source-shared question', async () => {
      const res = await fetch(publicQuestionsUrl);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.include(text, sourceShared.qid);
      assert.include(text, sourceShared.title);
    });

    it('does not list a question that is not shared', async () => {
      const res = await fetch(publicQuestionsUrl);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.notInclude(text, notShared.qid);
      assert.notInclude(text, notShared.title);
    });

    it('blocks access in Exam mode', async () => {
      const res = await fetch(publicQuestionsUrl, {
        headers: {
          Cookie: 'pl_test_mode=Exam',
        },
      });
      assert.equal(res.status, 403);
    });
  });

  describe('access control for the public course', () => {
    it('returns 404 for a course that does not exist', async () => {
      const res = await fetch(baseUrl + '/public/course/999999/questions');
      assert.equal(res.status, 404);
    });
  });
});
