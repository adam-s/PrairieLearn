import { afterEach, assert, beforeEach, describe, expect, it } from 'vitest';

import { type AuditEvent } from '../lib/db-types.js';
import * as helperCourse from '../tests/helperCourse.js';
import * as helperDb from '../tests/helperDb.js';
import { getOrCreateUser } from '../tests/utils/auth.js';

import { selectAssessmentQuestionById } from './assessment-question.js';
import { selectAssessmentById } from './assessment.js';
import {
  type InsertAuditEventParams,
  insertAuditEvent,
  insertAuditEvents,
  selectAuditEvents,
} from './audit-event.js';
import { selectUserById } from './user.js';

describe('audit-event', () => {
  beforeEach(async function () {
    await helperDb.before();
    await helperCourse.syncCourse();
  });

  afterEach(async function () {
    await helperDb.after();
  });

  describe('insertAuditEvent', () => {
    it('inserts a basic audit event successfully', async () => {
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      const { date: _date, ...auditEvent } = await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        actionDetail: null,
        newRow: await selectUserById('1'),
        context: { test: 'basic' },
      });
      expect(auditEvent).toMatchInlineSnapshot(`
        {
          "action": "insert",
          "action_detail": null,
          "agent_authn_user_id": "1",
          "agent_user_id": "1",
          "assessment_id": null,
          "assessment_instance_id": null,
          "assessment_question_id": null,
          "context": {
            "test": "basic",
          },
          "course_id": "1",
          "course_instance_id": "1",
          "enrollment_id": null,
          "id": "1",
          "institution_id": "1",
          "new_row": {
            "deleted_at": null,
            "email": "student@example.com",
            "id": "1",
            "institution_id": "1",
            "lti_context_id": null,
            "lti_course_instance_id": null,
            "lti_user_id": null,
            "name": "Example Student",
            "stripe_customer_id": null,
            "terms_accepted_at": null,
            "uid": "student@example.com",
            "uin": "student",
          },
          "old_row": null,
          "row_id": "1",
          "subject_user_id": "1",
          "table_name": "users",
          "team_id": null,
        }
      `);
    });

    it('uses default values for optional parameters', async () => {
      const user = await getOrCreateUser({
        uid: 'default@example.com',
        name: 'Default User',
        uin: 'default',
        email: 'default@example.com',
      });

      const { date: _date, ...auditEvent } = await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: null,
        agentUserId: null,
        subjectUserId: user.id,
        newRow: { test: 'default user data' },
      });
      expect(auditEvent).toMatchInlineSnapshot(`
        {
          "action": "insert",
          "action_detail": null,
          "agent_authn_user_id": null,
          "agent_user_id": null,
          "assessment_id": null,
          "assessment_instance_id": null,
          "assessment_question_id": null,
          "context": {},
          "course_id": null,
          "course_instance_id": null,
          "enrollment_id": null,
          "id": "1",
          "institution_id": null,
          "new_row": {
            "test": "default user data",
          },
          "old_row": null,
          "row_id": "1",
          "subject_user_id": "1",
          "table_name": "users",
          "team_id": null,
        }
      `);
    });

    it('fills in missing fields for assessments', async () => {
      const user = await getOrCreateUser({
        uid: 'instructor@example.com',
        name: 'Instructor',
        uin: 'instructor',
        email: 'instructor@example.com',
      });

      const assessment = await selectAssessmentById('1');

      const auditEvent = await insertAuditEvent({
        action: 'insert',
        tableName: 'assessments',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        assessmentId: assessment.id,
        newRow: { title: 'Midterm 1' },
      });
      assert.equal(auditEvent.course_id, '1');
      assert.equal(auditEvent.course_instance_id, assessment.course_instance_id);
      assert.equal(auditEvent.assessment_id, '1');
      assert.equal(auditEvent.institution_id, '1');
    });

    it('fills in missing fields for assessment questions', async () => {
      const user = await getOrCreateUser({
        uid: 'student2@example.com',
        name: 'Example Student 2',
        uin: 'student2',
        email: 'student2@example.com',
      });

      const assessmentQuestion = await selectAssessmentQuestionById('1');
      const assessment = await selectAssessmentById(assessmentQuestion.assessment_id);

      const auditEvent = await insertAuditEvent({
        action: 'insert',
        tableName: 'assessment_questions',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        assessmentQuestionId: assessmentQuestion.id,
        newRow: { status: 'active' },
      });
      assert.equal(auditEvent.course_id, '1');
      assert.equal(auditEvent.course_instance_id, assessment.course_instance_id);
      assert.equal(auditEvent.assessment_id, assessment.id);
      assert.equal(auditEvent.assessment_question_id, '1');
      assert.equal(auditEvent.institution_id, '1');
    });
  });

  describe('selectAuditEvents', () => {
    it('throws error when both subject_user_id and agent_authn_user_id are provided', async () => {
      try {
        await selectAuditEvents({
          subject_user_id: '1',
          agent_authn_user_id: '1',
          table_names: ['users'],
          course_instance_id: '1',
        });
        assert.fail('Expected error to be thrown');
      } catch (error: any) {
        assert.match(
          error.message,
          /subject_user_id and agent_authn_user_id cannot both be provided/,
        );
      }
    });

    it('throws error when neither subject_user_id nor agent_authn_user_id are provided', async () => {
      try {
        await selectAuditEvents({
          table_names: ['users'],
          course_instance_id: '1',
        });
        assert.fail('Expected error to be thrown');
      } catch (error: any) {
        assert.match(error.message, /subject_user_id or agent_authn_user_id must be provided/);
      }
    });

    it('returns empty array when no audit events exist', async () => {
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      const result = await selectAuditEvents({
        subject_user_id: user.id,
        table_names: ['users'],
        course_instance_id: '1',
      });

      assert.deepEqual(result, []);
    });

    it('returns audit events for a single table name', async () => {
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      // Insert test audit events
      const auditEvent1 = await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        newRow: await selectUserById('1'),
        context: { test: 'data1' },
      });

      const auditEvent2 = await insertAuditEvent({
        action: 'update',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        actionDetail: 'TEST_VALUE' as any,
        oldRow: { test: 'old data' },
        context: { test: 'data2' },
      });

      const result = await selectAuditEvents({
        subject_user_id: user.id,
        table_names: ['users'],
        course_instance_id: '1',
      });

      assert.equal(result.length, 2);
      // Results should be ordered by date DESC
      assert.equal(result[0].id, auditEvent2.id);
      assert.equal(result[1].id, auditEvent1.id);
    });

    it('returns audit events for multiple table names', async () => {
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      // Insert test audit events for different tables
      const usersAuditEvent = await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        newRow: { test: 'new user data' },
        context: { test: 'users' },
      });

      const enrollmentsAuditEvent = await insertAuditEvent({
        action: 'insert',
        actionDetail: 'implicit_joined',
        tableName: 'enrollments',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        newRow: { test: 'new enrollment data' },
        context: { test: 'enrollments' },
      });

      // Insert an audit event for a table not in the list
      await insertAuditEvent({
        action: 'insert',
        tableName: 'assessments',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        assessmentId: '1',
        newRow: { test: 'new assessment data' },
        context: { test: 'assessments' },
      });

      const result = await selectAuditEvents({
        subject_user_id: user.id,
        table_names: ['users', 'enrollments'],
        course_instance_id: '1',
      });

      assert.equal(result.length, 2);
      // Results should be ordered by date DESC
      assert.equal(result[0].id, enrollmentsAuditEvent.id);
      assert.equal(result[1].id, usersAuditEvent.id);
    });

    it('filters by course_instance_id correctly', async () => {
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      // Insert audit events for different course instances
      await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        newRow: { test: 'course1 user data' },
        context: { test: 'course1' },
      });

      await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '2',
        newRow: { test: 'course2 user data' },
        context: { test: 'course2' },
      });

      const result = await selectAuditEvents({
        subject_user_id: user.id,
        table_names: ['users'],
        course_instance_id: '1',
      });

      assert.equal(result.length, 1);
      assert.equal(result[0].course_instance_id, '1');
    });

    it('filters by subject_user_id correctly', async () => {
      const user1 = await getOrCreateUser({
        uid: 'student1@example.com',
        name: 'Example Student 1',
        uin: 'student1',
        email: 'student1@example.com',
      });

      const user2 = await getOrCreateUser({
        uid: 'student2@example.com',
        name: 'Example Student 2',
        uin: 'student2',
        email: 'student2@example.com',
      });

      // Insert audit events for different users
      await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user1.id,
        courseInstanceId: '1',
        newRow: user1,
        context: { test: 'user1' },
      });

      await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user2.id,
        courseInstanceId: '1',
        context: user2,
        newRow: await selectUserById('1'),
      });

      const result = await selectAuditEvents({
        subject_user_id: user1.id,
        table_names: ['users'],
        course_instance_id: '1',
      });

      assert.equal(result.length, 1);
      assert.equal(result[0].subject_user_id, user1.id);
    });

    it('orders results by date DESC', async () => {
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      const olderEvent = await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        newRow: { test: 'older user data' },
        context: { test: 'older' },
      });

      const newerEvent = await insertAuditEvent({
        action: 'update',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        actionDetail: 'TEST_VALUE' as any,
        oldRow: { test: 'old data' },
        context: { test: 'newer' },
      });

      const result = await selectAuditEvents({
        subject_user_id: user.id,
        table_names: ['users'],
        course_instance_id: '1',
      });

      assert.equal(result.length, 2);
      // Newer event should come first
      assert.equal(result[0].id, newerEvent.id);
      assert.equal(result[1].id, olderEvent.id);
    });

    it('handles selectAuditEvents with agent_authn_user_id correctly', async () => {
      // Insert audit event with undefined subject_user_id
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      await insertAuditEvent({
        action: 'insert',
        tableName: 'users',
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        newRow: { test: 'new user data' },
        context: { test: 'null_user' },
      });

      const result = await selectAuditEvents({
        agent_authn_user_id: '1',
        table_names: ['users'],
        course_instance_id: '1',
      });

      assert.equal(result.length, 1);
    });

    it('includes all audit event fields in result', async () => {
      const user = await getOrCreateUser({
        uid: 'student@example.com',
        name: 'Example Student',
        uin: 'student',
        email: 'student@example.com',
      });

      const { date: _date, ...auditEvent } = await insertAuditEvent({
        action: 'update',
        tableName: 'users',
        rowId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        actionDetail: 'TEST_VALUE' as any,
        context: { test: 'full_fields' },
        oldRow: { name: 'Old Name' },
        newRow: { name: 'New Name' },
        agentAuthnUserId: '1',
        agentUserId: '1',
        institutionId: '1',
        courseId: '1',
        assessmentId: '1',
        assessmentInstanceId: '1',
        assessmentQuestionId: '1',
        groupId: '1',
      });
      const result = await selectAuditEvents({
        subject_user_id: user.id,
        table_names: ['users'],
        course_instance_id: '1',
      });

      assert.equal(result[0].id, auditEvent.id);
      expect(auditEvent).toMatchInlineSnapshot(`
        {
          "action": "update",
          "action_detail": "TEST_VALUE",
          "agent_authn_user_id": "1",
          "agent_user_id": "1",
          "assessment_id": "1",
          "assessment_instance_id": "1",
          "assessment_question_id": "1",
          "context": {
            "test": "full_fields",
          },
          "course_id": "1",
          "course_instance_id": "1",
          "enrollment_id": null,
          "id": "1",
          "institution_id": "1",
          "new_row": {
            "name": "New Name",
          },
          "old_row": {
            "name": "Old Name",
          },
          "row_id": "1",
          "subject_user_id": "1",
          "table_name": "users",
          "team_id": null,
        }
      `);
    });
  });

  describe('insertAuditEvents', () => {
    // Fields that are auto-generated per inserted row and therefore legitimately
    // differ between the singular and batched paths (a fresh sequence id and an
    // insertion timestamp). Everything else must be byte-identical.
    const normalize = (event: AuditEvent) => {
      const { id: _id, date: _date, ...rest } = event;
      return rest;
    };

    it('returns an empty array for an empty list without inserting', async () => {
      const result = await insertAuditEvents([]);
      assert.deepEqual(result, []);

      const all = await selectAuditEvents({
        agent_authn_user_id: '1',
        course_instance_id: '1',
        table_names: ['users'],
      });
      assert.equal(all.length, 0);
    });

    it('writes exactly the same rows as N singular insertAuditEvent calls', async () => {
      const user = await getOrCreateUser({
        uid: 'batch@example.com',
        name: 'Batch User',
        uin: 'batch',
        email: 'batch@example.com',
      });
      const assessment = await selectAssessmentById('1');
      const assessmentQuestion = await selectAssessmentQuestionById('1');

      // A heterogeneous batch that exercises every metadata LATERAL lookup that
      // differs row-to-row: a plain user row, an assessment row (assessment ->
      // course_instance -> course -> institution chain), an assessment-question
      // row (its own chain), and an assessment_instances row whose id does not
      // exist (no FK constraint) so the `coalesce(meta.id, e.assessment_instance_id)`
      // special-case must preserve the raw id rather than null it out.
      const paramsList: InsertAuditEventParams[] = [
        {
          action: 'insert',
          tableName: 'users',
          rowId: '1',
          agentAuthnUserId: '1',
          agentUserId: '1',
          subjectUserId: user.id,
          courseInstanceId: '1',
          actionDetail: null,
          newRow: await selectUserById('1'),
          context: { batch: 'user' },
        },
        {
          action: 'insert',
          tableName: 'assessments',
          rowId: '1',
          agentAuthnUserId: '1',
          agentUserId: '1',
          subjectUserId: user.id,
          assessmentId: assessment.id,
          newRow: { title: 'Midterm 1' },
          context: { batch: 'assessment' },
        },
        {
          action: 'insert',
          tableName: 'assessment_questions',
          rowId: '1',
          agentAuthnUserId: '1',
          agentUserId: '1',
          subjectUserId: user.id,
          assessmentQuestionId: assessmentQuestion.id,
          newRow: { status: 'active' },
          context: { batch: 'assessment_question' },
        },
        {
          action: 'insert',
          tableName: 'assessment_instances',
          rowId: '999999',
          agentAuthnUserId: '1',
          agentUserId: '1',
          subjectUserId: user.id,
          // A non-existent assessment_instance_id (no FK constraint): the
          // coalesce must keep this value rather than null it out.
          assessmentInstanceId: '999999',
          newRow: { points: 0 },
          context: { batch: 'assessment_instance' },
        },
      ];

      // Path A: one batched insert.
      const batched = await insertAuditEvents(paramsList);
      assert.equal(batched.length, paramsList.length);

      // Path B: N singular inserts of the identical params.
      const singular: AuditEvent[] = [];
      for (const params of paramsList) {
        singular.push(await insertAuditEvent(params));
      }

      // The batched rows must equal the singular rows one-for-one (input order),
      // ignoring only the auto-generated id + date.
      assert.equal(batched.length, singular.length);
      for (let i = 0; i < paramsList.length; i++) {
        assert.deepEqual(
          normalize(batched[i]),
          normalize(singular[i]),
          `row ${i} (${paramsList[i].tableName}/${paramsList[i].action}) differs between batched and singular`,
        );
      }

      // The coalesce special-case actually preserved the hard-deleted id.
      assert.equal(batched[3].assessment_instance_id, '999999');
      // And the inferred chains resolved (not left null) for the assessment row.
      assert.equal(batched[1].course_id, '1');
      assert.equal(batched[1].institution_id, '1');
      assert.equal(batched[1].assessment_id, '1');
    });

    it('inserts every event in input order and persists them', async () => {
      const user = await getOrCreateUser({
        uid: 'order@example.com',
        name: 'Order User',
        uin: 'order',
        email: 'order@example.com',
      });

      const paramsList: InsertAuditEventParams[] = [0, 1, 2].map((n) => ({
        action: 'insert' as const,
        tableName: 'users' as const,
        rowId: '1',
        agentAuthnUserId: '1',
        agentUserId: '1',
        subjectUserId: user.id,
        courseInstanceId: '1',
        actionDetail: null,
        newRow: { name: `Row ${n}` },
        context: { order: n },
      }));

      const inserted = await insertAuditEvents(paramsList);
      assert.deepEqual(
        inserted.map((e) => e.context),
        [{ order: 0 }, { order: 1 }, { order: 2 }],
      );

      // All three landed in the DB.
      const persisted = await selectAuditEvents({
        subject_user_id: user.id,
        table_names: ['users'],
        course_instance_id: '1',
      });
      assert.equal(persisted.length, 3);
    });
  });
});
