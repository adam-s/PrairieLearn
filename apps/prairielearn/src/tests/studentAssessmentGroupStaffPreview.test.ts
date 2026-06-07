import { afterAll, assert, beforeAll, describe, test } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { config } from '../lib/config.js';
import {
  insertCourseInstancePermissions,
  insertCoursePermissionsByUserUid,
} from '../models/course-permissions.js';

import { fetchCheerio } from './helperClient.js';
import * as helperServer from './helperServer.js';
import { getOrCreateUser } from './utils/auth.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

// Regression test for issue #6636: when course staff use "Student view without access
// restrictions" on a group (team-work) assessment and are not in a group, they should be
// placed in a singleton temporary group and allowed to preview the assessment, instead of
// being shown the student join/create gate (or the dead-end "wait to be assigned" message).
// A real student (plain "Student view") must still be required to join a group.
//
// In dev mode, hitting the STUDENT assessment route as `test_instructor` (a user that
// holds course-instance permissions) is exactly "Student view without access
// restrictions": the effective student still has has_course_instance_permission_view.

const siteUrl = 'http://localhost:' + config.serverPort;
const courseInstanceUrl = siteUrl + '/pl/course_instance/1';

function assessmentUrl(id: string): string {
  return `${courseInstanceUrl}/assessment/${id}`;
}

const STAFF_COOKIE = { cookie: 'pl_test_user=test_instructor' };
const STUDENT_COOKIE = { cookie: 'pl_test_user=test_student' };

async function countGroups(assessment_id: string): Promise<number> {
  return await sqldb
    .queryRow(sql.count_groups_for_assessment, { assessment_id }, z.object({ count: z.number() }))
    .then((r) => r.count);
}

describe('Group assessment staff preview (student view without access restrictions)', () => {
  let selfOrganizableAssessmentId: string;
  let instructorAssignedAssessmentId: string;

  beforeAll(helperServer.before());

  beforeAll(async () => {
    // Make `instructor@example.com` (the `test_instructor` dev user) course staff with
    // instance access, so the student route renders "student view without access
    // restrictions" rather than plain student view.
    const instructor = await getOrCreateUser({
      uid: 'instructor@example.com',
      name: 'Instructor User',
      uin: '100000000',
      email: 'instructor@example.com',
    });
    await insertCoursePermissionsByUserUid({
      course_id: '1',
      uid: instructor.uid,
      course_role: 'Owner',
      authn_user_id: instructor.id,
    });
    await insertCourseInstancePermissions({
      course_id: '1',
      user_id: instructor.id,
      course_instance_id: '1',
      course_instance_role: 'Student Data Editor',
      authn_user_id: instructor.id,
    });

    const groupAssessments = await sqldb.queryScalars(sql.select_group_work_assessments, IdSchema);
    assert.isAtLeast(
      groupAssessments.length,
      2,
      'expected >= 2 HW group assessments in test course',
    );
    selfOrganizableAssessmentId = groupAssessments[0];
    instructorAssignedAssessmentId = groupAssessments[1];

    // Turn the second assessment into the "instructor-assigned" variant: students may
    // neither create nor join groups, so an ungrouped viewer would otherwise hit the
    // dead-end "wait for the instructor to assign groups" gate.
    await sqldb.execute(sql.disable_student_group_authz, {
      assessment_id: instructorAssignedAssessmentId,
    });
  });

  afterAll(helperServer.after);

  test.sequential(
    'staff are placed in a singleton group on a self-organizable group assessment',
    async () => {
      const before = await countGroups(selfOrganizableAssessmentId);

      const res = await fetchCheerio(assessmentUrl(selfOrganizableAssessmentId), {
        headers: STAFF_COOKIE,
      });
      assert.equal(res.status, 200);

      // No student join/create gate; a singleton group + Start button instead.
      assert.lengthOf(res.$('#create-form'), 0, 'create-group form should not be shown to staff');
      assert.lengthOf(res.$('#joingroup-form'), 0, 'join-group form should not be shown to staff');
      assert.lengthOf(res.$('#start-assessment'), 1, 'Start assessment button should be present');

      const after = await countGroups(selfOrganizableAssessmentId);
      assert.equal(after, before + 1, 'exactly one singleton group should be created for staff');
    },
  );

  test.sequential(
    'staff bypass the dead-end gate on an instructor-assigned group assessment',
    async () => {
      const res = await fetchCheerio(assessmentUrl(instructorAssignedAssessmentId), {
        headers: STAFF_COOKIE,
      });
      assert.equal(res.status, 200);

      const text = res.$('body').text();
      assert.notInclude(
        text,
        'wait for the instructor to assign groups',
        'staff must not see the dead-end gate',
      );
      assert.lengthOf(res.$('#start-assessment'), 1, 'Start assessment button should be present');
    },
  );

  test.sequential('a real student still hits the dead-end gate (no auto-group)', async () => {
    const before = await countGroups(instructorAssignedAssessmentId);

    const res = await fetchCheerio(assessmentUrl(instructorAssignedAssessmentId), {
      headers: STUDENT_COOKIE,
    });
    assert.equal(res.status, 200);

    const text = res.$('body').text();
    assert.include(
      text,
      'wait for the instructor to assign groups',
      'a real student must still see the dead-end gate',
    );
    assert.lengthOf(res.$('#start-assessment'), 0, 'no Start button for an ungrouped student');

    const after = await countGroups(instructorAssignedAssessmentId);
    assert.equal(after, before, 'no group should be created for a real student');
  });
});
