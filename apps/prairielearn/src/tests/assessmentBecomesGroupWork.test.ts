import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import { config } from '../lib/config.js';
import { AssessmentInstanceSchema } from '../lib/db-types.js';
import { selectAssessmentByTid } from '../models/assessment.js';
import { generateAndEnrollUsers } from '../models/enrollment.js';

import { fetchCheerio } from './helperClient.js';
import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const siteUrl = 'http://localhost:' + config.serverPort;
const baseUrl = siteUrl + '/pl';
const courseInstanceUrl = baseUrl + '/course_instance/1';

const storedConfig: Record<string, any> = {};

/**
 * Regression for https://github.com/PrairieLearn/PrairieLearn/issues/5092
 *
 * An assessment can be switched to group work (`groupWork: true`, synced to
 * `assessments.team_work = true`) AFTER students already have individual
 * (non-group) assessment instances open. Those pre-existing individual instances
 * have `team_id IS NULL`. Two paths assumed every instance of a team_work
 * assessment is a group instance:
 *
 *   - the student got a hard "Access denied" (403) on their own instance
 *     (authz_assessment_instance treated a null team_id as "not a member");
 *   - an instructor viewing that student's instance got a 500 "Incorrect rowCount"
 *     (studentAssessmentInstance unconditionally fetched group info with a null id).
 */
describe('Assessment switched to group work while an individual instance is open', () => {
  beforeAll(helperServer.before());

  beforeAll(() => {
    storedConfig.authUid = config.authUid;
    storedConfig.authName = config.authName;
    storedConfig.authUin = config.authUin;
  });

  afterAll(helperServer.after);

  afterAll(() => {
    Object.assign(config, storedConfig);
  });

  let assessmentId: string;
  let assessmentInstanceUrl: string;
  const student = { uid: '', name: '', uin: '55500001' };

  it('a student creates an individual instance of a non-group Homework', async () => {
    const { id } = await selectAssessmentByTid({
      course_instance_id: '1',
      tid: 'hw1-automaticTestSuite',
    });
    assessmentId = id;

    const [enrolled] = await generateAndEnrollUsers({ count: 1, course_instance_id: '1' });
    assert.isDefined(enrolled);
    student.uid = enrolled.uid;
    student.name = enrolled.name ?? 'Student';

    // Become the student and start the assessment (creates an individual instance).
    config.authUid = student.uid;
    config.authName = student.name;
    config.authUin = student.uin;

    const res = await fetchCheerio(`${courseInstanceUrl}/assessment/${assessmentId}/`);
    assert.equal(res.status, 200, 'student should be able to start the assessment');
    // Starting redirects to the new assessment instance.
    assessmentInstanceUrl = res.url;
    assert.match(res.url, /\/assessment_instance\/\d+$/);

    const ai = await sqldb.queryRow(sql.select_assessment_instance, AssessmentInstanceSchema);
    assert.isNull(ai.team_id, 'instance must be individual (no team)');
    assert.equal(ai.user_id, enrolled.id);
  });

  it('the instructor switches the assessment to group work (post-sync state)', async () => {
    // This mirrors what sync produces from `groupWork: true`: the assessment is
    // flagged team_work and a team_configs row is created. The pre-existing
    // individual instance is intentionally left untouched (team_id stays NULL).
    await sqldb.execute(sql.enable_team_work, { assessment_id: assessmentId });
    const teamWork = await sqldb.queryRow(
      sql.select_team_work,
      { assessment_id: assessmentId },
      z.object({ team_work: z.boolean() }),
    );
    assert.isTrue(teamWork.team_work);
  });

  it('the student can still open their own individual instance (no "Access denied")', async () => {
    config.authUid = student.uid;
    config.authName = student.name;
    config.authUin = student.uin;

    const res = await fetchCheerio(assessmentInstanceUrl);
    // Before the fix: 403 "Access denied" from selectAndAuthzAssessmentInstance.
    assert.notEqual(res.status, 403, 'student must not be locked out of their own instance');
    assert.equal(res.status, 200);
  });

  it('an instructor can open the student\'s individual instance (no "Incorrect rowCount")', async () => {
    // The default dev user is the course owner / instructor.
    config.authUid = storedConfig.authUid;
    config.authName = storedConfig.authName;
    config.authUin = storedConfig.authUin;

    const res = await fetchCheerio(assessmentInstanceUrl);
    // Before the fix: 500 "Incorrect rowCount: 0" from getGroupInfo(null).
    assert.equal(res.status, 200, 'instructor should be able to view the individual instance');
  });
});
