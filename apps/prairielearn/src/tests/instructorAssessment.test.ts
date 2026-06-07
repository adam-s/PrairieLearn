import * as cheerio from 'cheerio';
import type { DataNode, Element } from 'domhandler';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';
import { IdSchema } from '@prairielearn/zod';

import { GradingJobSchema, InstanceQuestionSchema, SubmissionSchema } from '../lib/db-types.js';
import { selectAssessmentInstancesForTable } from '../trpc/assessment/assessment-instances.js';

import * as helperExam from './helperExam.js';
import type { TestExamQuestion } from './helperExam.js';
import * as helperQuestion from './helperQuestion.js';
import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const locals = {} as {
  $: cheerio.CheerioAPI;
  shouldHaveButtons: string[];
  postAction: string;
  question: TestExamQuestion;
  expectedResult: {
    submission_score: number;
    submission_correct: boolean;
    instance_question_points: number;
    instance_question_score_perc: number;
    instance_question_auto_points: number;
    instance_question_manual_points: number;
    assessment_instance_points: number;
    assessment_instance_score_perc: number;
  };
  getSubmittedAnswer: (variant: any) => object;
  instructorAssessmentsUrl: string;
  instructorAssessmentUrl: string;
  instructorAssessmentInstancesUrl: string;
  instructorBaseUrl: string;
  instructorAssessmentInstanceUrl: string;
  siteUrl: string;
  assessment_id: string;
  __csrf_token: string;
  __action: string;
  instance_question_id: number;
  postEndTime: number;
  pageData: any[];
  data$: cheerio.CheerioAPI;
  instructorGradebookUrl: string;
  gradebookData: any[];
  gradebookDataRow: any;
};

const assessmentSetScorePerc = 37;
const assessmentSetScorePerc2 = 83;

describe('Instructor assessment editing', { timeout: 20_000 }, function () {
  beforeAll(helperServer.before());

  afterAll(helperServer.after);

  let page: string;
  let elemList: cheerio.Cheerio<Element>;

  helperExam.startExam(locals, 'exam1-automaticTestSuite');

  describe('1. grade incorrect answer to question addNumbers', function () {
    describe('setting up the submission data', function () {
      it('should succeed', function () {
        locals.shouldHaveButtons = ['grade', 'save'];
        locals.postAction = 'grade';
        locals.question = helperExam.exam1AutomaticTestSuite.keyedQuestions.addNumbers;
        locals.expectedResult = {
          submission_score: 0,
          submission_correct: false,
          instance_question_points: 0,
          instance_question_score_perc: (0 / 5) * 100,
          instance_question_auto_points: 0,
          instance_question_manual_points: 0,
          assessment_instance_points: 0,
          assessment_instance_score_perc: (0 / helperExam.exam1AutomaticTestSuite.maxPoints) * 100,
        };
        locals.getSubmittedAnswer = function (variant: any) {
          return {
            c: variant.true_answer.c + 1,
          };
        };
      });
    });
    helperQuestion.getInstanceQuestion(locals);
    helperQuestion.postInstanceQuestion(locals);
    helperQuestion.checkQuestionScore(locals);
    helperQuestion.checkAssessmentScore(locals);
  });

  describe('2. grade correct answer to question addNumbers', function () {
    describe('setting up the submission data', function () {
      it('should succeed', function () {
        locals.shouldHaveButtons = ['grade', 'save'];
        locals.postAction = 'grade';
        locals.question = helperExam.exam1AutomaticTestSuite.keyedQuestions.addNumbers;
        locals.expectedResult = {
          submission_score: 1,
          submission_correct: true,
          instance_question_points: 3,
          instance_question_score_perc: (3 / 5) * 100,
          instance_question_auto_points: 3,
          instance_question_manual_points: 0,
          assessment_instance_points: 3,
          assessment_instance_score_perc: (3 / helperExam.exam1AutomaticTestSuite.maxPoints) * 100,
        };
        locals.getSubmittedAnswer = function (variant: any) {
          return {
            c: variant.true_answer.c,
          };
        };
      });
    });
    helperQuestion.getInstanceQuestion(locals);
    helperQuestion.postInstanceQuestion(locals);
    helperQuestion.checkQuestionScore(locals);
    helperQuestion.checkAssessmentScore(locals);
  });

  describe('3. grade correct answer to question addVectors', function () {
    describe('setting up the submission data', function () {
      it('should succeed', function () {
        locals.shouldHaveButtons = ['grade', 'save'];
        locals.postAction = 'grade';
        locals.question = helperExam.exam1AutomaticTestSuite.keyedQuestions.addVectors;
        locals.expectedResult = {
          submission_score: 1,
          submission_correct: true,
          instance_question_points: 11,
          instance_question_score_perc: (11 / 21) * 100,
          instance_question_auto_points: 11,
          instance_question_manual_points: 0,
          assessment_instance_points: 14,
          assessment_instance_score_perc: (14 / helperExam.exam1AutomaticTestSuite.maxPoints) * 100,
        };
        locals.getSubmittedAnswer = function (variant) {
          return {
            wx: variant.true_answer.wx,
            wy: variant.true_answer.wy,
          };
        };
      });
    });
    helperQuestion.getInstanceQuestion(locals);
    helperQuestion.postInstanceQuestion(locals);
    helperQuestion.checkQuestionScore(locals);
    helperQuestion.checkAssessmentScore(locals);
  });

  describe('4. GET to instructor assessments URL', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorAssessmentsUrl);
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
    it('should contain E1', function () {
      elemList = locals.$('td a:contains("Exam for automatic test suite")');
      assert.lengthOf(elemList, 1);
    });
    it('should have the correct link for E1', function () {
      locals.instructorAssessmentUrl = locals.siteUrl + elemList[0].attribs.href;
      assert.equal(
        locals.instructorAssessmentUrl,
        locals.instructorBaseUrl + '/assessment/' + locals.assessment_id + '/',
      );
    });
  });

  describe('5. GET to instructor assessment instances URL', function () {
    it('should load successfully', async () => {
      locals.instructorAssessmentInstancesUrl = locals.instructorAssessmentUrl + 'instances';
      const res = await fetch(locals.instructorAssessmentInstancesUrl);
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
    it('should contain the assessment instance', async () => {
      const rows = await selectAssessmentInstancesForTable({
        assessment_id: locals.assessment_id,
        timezone: 'UTC',
      });
      const pageItems = rows.filter((row) => row.user?.uid === 'dev@example.com');
      assert.lengthOf(pageItems, 1);
      locals.instructorAssessmentInstanceUrl =
        locals.instructorBaseUrl + '/assessment_instance/' + pageItems[0].assessment_instance.id;
    });
  });

  describe('6. GET to instructor assessment instance URL', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorAssessmentInstanceUrl);
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
  });

  describe('7. edit-question-points form', function () {
    it('should exist', function () {
      elemList = locals.$(
        '#instanceQuestionList td:contains("addNumbers") ~ td button[data-testid="edit-question-points-score-button-points"]',
      );
      assert.lengthOf(elemList, 1);
    });
    it('should have data-bs-content', function () {
      assert.isString(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should parse', function () {
      locals.data$ = cheerio.load(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should have a CSRF token', function () {
      elemList = locals.data$('form input[name="__csrf_token"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__csrf_token = elemList[0].attribs.value;
      assert.isString(locals.__csrf_token);
    });
    it('data-bs-content should have an __action', function () {
      elemList = locals.data$('form input[name="__action"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__action = elemList[0].attribs.value;
      assert.isString(locals.__action);
      assert.equal(locals.__action, 'edit_question_points');
    });
    it('data-bs-content should have an instance_question_id', function () {
      elemList = locals.data$('form input[name="instance_question_id"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.instance_question_id = Number.parseInt(elemList[0].attribs.value);
    });
    it('data-bs-content should have a points input', function () {
      elemList = locals.data$('form input[name="points"]');
      assert.lengthOf(elemList, 1);
    });
  });

  describe('8. POST to instructor assessment instance URL to set question points', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorAssessmentInstanceUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: locals.__action,
          __csrf_token: locals.__csrf_token,
          instance_question_id: `${locals.instance_question_id}`,
          points: '4',
        }),
      });
      locals.postEndTime = Date.now();
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
    it('should update the total points correctly', function () {
      elemList = locals.$('#total-points');
      assert.lengthOf(elemList, 1);
      const totalPoints = Number.parseFloat((elemList[0].children[0] as DataNode).data);
      assert.equal(totalPoints, 15);
    });
  });

  describe('9. edit-question-score-perc form', function () {
    it('should exist', function () {
      elemList = locals.$(
        '#instanceQuestionList td:contains("addNumbers") ~ td button[data-testid="edit-question-points-score-button-score_perc"]',
      );
      assert.lengthOf(elemList, 1);
    });
    it('should have data-bs-content', function () {
      assert.isString(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should parse', function () {
      locals.data$ = cheerio.load(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should have a CSRF token', function () {
      elemList = locals.data$('form input[name="__csrf_token"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__csrf_token = elemList[0].attribs.value;
      assert.isString(locals.__csrf_token);
    });
    it('data-bs-content should have an __action', function () {
      elemList = locals.data$('form input[name="__action"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__action = elemList[0].attribs.value;
      assert.isString(locals.__action);
      assert.equal(locals.__action, 'edit_question_points');
    });
    it('data-bs-content should have an instance_question_id', function () {
      elemList = locals.data$('form input[name="instance_question_id"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.instance_question_id = Number.parseInt(elemList[0].attribs.value);
    });
    it('data-bs-content should have a score_perc input', function () {
      elemList = locals.data$('form input[name="score_perc"]');
      assert.lengthOf(elemList, 1);
    });
  });

  describe('10. POST to instructor assessment instance URL to set question score_perc', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorAssessmentInstanceUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: locals.__action,
          __csrf_token: locals.__csrf_token,
          instance_question_id: `${locals.instance_question_id}`,
          score_perc: '50',
        }),
      });
      locals.postEndTime = Date.now();
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
    it('should update the total points correctly', function () {
      elemList = locals.$('#total-points');
      assert.lengthOf(elemList, 1);
      const totalPoints = Number.parseFloat((elemList[0].children[0] as DataNode).data);
      assert.equal(totalPoints, 13.5);
    });
  });

  describe('11. edit-total-points form', function () {
    it('should exist', function () {
      elemList = locals.$('#editTotalPointsButton');
      assert.lengthOf(elemList, 1);
    });
    it('should have data-bs-content', function () {
      assert.isString(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should parse', function () {
      locals.data$ = cheerio.load(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should have a CSRF token', function () {
      elemList = locals.data$('form input[name="__csrf_token"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__csrf_token = elemList[0].attribs.value;
      assert.isString(locals.__csrf_token);
    });
    it('data-bs-content should have an __action', function () {
      elemList = locals.data$('form input[name="__action"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__action = elemList[0].attribs.value;
      assert.isString(locals.__action);
      assert.equal(locals.__action, 'edit_total_points');
    });
    it('data-bs-content should have the correct assessment_instance_id', function () {
      elemList = locals.data$('form input[name="assessment_instance_id"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      const assessment_instance_id = Number.parseInt(elemList[0].attribs.value);
      assert.equal(assessment_instance_id, 1);
    });
    it('data-bs-content should have a points input', function () {
      elemList = locals.data$('form input[name="points"]');
      assert.lengthOf(elemList, 1);
    });
  });

  describe('12. POST to instructor assessment instance URL to set total points', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorAssessmentInstanceUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: locals.__action,
          __csrf_token: locals.__csrf_token,
          assessment_instance_id: '1',
          points: '7',
        }),
      });
      locals.postEndTime = Date.now();
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
    it('should update the total points correctly', function () {
      elemList = locals.$('#total-points');
      assert.lengthOf(elemList, 1);
      const totalPoints = Number.parseFloat((elemList[0].children[0] as DataNode).data);
      assert.equal(totalPoints, 7);
    });
  });

  describe('13. edit-total-score-perc form', function () {
    it('should exist', function () {
      elemList = locals.$('#editTotalScorePercButton');
      assert.lengthOf(elemList, 1);
    });
    it('should have data-bs-content', function () {
      assert.isString(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should parse', function () {
      locals.data$ = cheerio.load(elemList[0].attribs['data-bs-content']);
    });
    it('data-bs-content should have a CSRF token', function () {
      elemList = locals.data$('form input[name="__csrf_token"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__csrf_token = elemList[0].attribs.value;
      assert.isString(locals.__csrf_token);
    });
    it('data-bs-content should have an __action', function () {
      elemList = locals.data$('form input[name="__action"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      locals.__action = elemList[0].attribs.value;
      assert.isString(locals.__action);
      assert.equal(locals.__action, 'edit_total_score_perc');
    });
    it('data-bs-content should have the correct assessment_instance_id', function () {
      elemList = locals.data$('form input[name="assessment_instance_id"]');
      assert.lengthOf(elemList, 1);
      assert.nestedProperty(elemList[0], 'attribs.value');
      const assessment_instance_id = Number.parseInt(elemList[0].attribs.value);
      assert.equal(assessment_instance_id, 1);
    });
    it('data-bs-content should have a score_perc input', function () {
      elemList = locals.data$('form input[name="score_perc"]');
      assert.lengthOf(elemList, 1);
    });
  });

  describe('14. POST to instructor assessment instance URL to set total score_perc', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorAssessmentInstanceUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: locals.__action,
          __csrf_token: locals.__csrf_token,
          assessment_instance_id: '1',
          score_perc: assessmentSetScorePerc.toString(),
        }),
      });
      locals.postEndTime = Date.now();
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
    it('should update the total points correctly', function () {
      elemList = locals.$('#total-points');
      assert.lengthOf(elemList, 1);
      const totalPoints = Number.parseFloat((elemList[0].children[0] as DataNode).data);
      assert.equal(
        totalPoints,
        (assessmentSetScorePerc / 100) * helperExam.exam1AutomaticTestSuite.maxPoints,
      );
    });
  });

  describe('15. GET to instructor gradebook URL', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorGradebookUrl);
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.$ = cheerio.load(page);
    });
    it('should have CSRF token for testing', function () {
      elemList = locals.$('#test_csrf_token');
      assert.lengthOf(elemList, 1);
      locals.__csrf_token = elemList.text();
      assert.isString(locals.__csrf_token);
    });
    it('should load raw data file successfully', async () => {
      const res = await fetch(locals.instructorGradebookUrl + '/raw_data.json');
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse as JSON array of objects', function () {
      locals.gradebookData = JSON.parse(page);
      assert.isArray(locals.gradebookData);
      locals.gradebookData.forEach((obj) => assert.isObject(obj));
    });
    it('should contain a row for the dev user', function () {
      locals.gradebookDataRow = locals.gradebookData.filter((row) => row.uid === 'dev@example.com');
      assert.lengthOf(locals.gradebookDataRow, 1);
    });
    it('should contain the correct score and assessment instance ID in the dev user row', function () {
      const score = locals.gradebookDataRow[0].scores[locals.assessment_id];
      assert.isObject(score);
      assert.equal(score.score_perc, assessmentSetScorePerc);
      assert.equal(score.assessment_instance_id, '1');
    });
  });

  describe('16. POST to instructor gradebook URL to set total score_perc', function () {
    it('should load successfully', async () => {
      const res = await fetch(locals.instructorGradebookUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: locals.__action,
          __csrf_token: locals.__csrf_token,
          assessment_instance_id: '1',
          score_perc: assessmentSetScorePerc2.toString(),
        }),
      });
      locals.postEndTime = Date.now();
      assert.equal(res.status, 200);
      page = await res.text();
    });
    it('should parse', function () {
      locals.pageData = JSON.parse(page);
    });
    it('should contain the correctly updated score', function () {
      assert.lengthOf(locals.pageData, 1);
      assert.equal(locals.pageData[0].score_perc, assessmentSetScorePerc2);
    });
  });

  // Regression coverage for https://github.com/PrairieLearn/PrairieLearn/issues/8805 (and the
  // bug it references, #8801). An instructor can manually edit the points of an instance question
  // that the student never submitted an answer to. In that case `updateInstanceQuestionScore` runs
  // with a null `submission_id` (the manual grading page is unavailable, so the points are edited
  // directly from the assessment instance page). This exercises that no-submission path end to end
  // and asserts the instance question is scored without creating a submission or grading job.
  describe('17. manually grade an instance question with no submission', function () {
    const gradedPoints = 4;
    let unansweredInstanceQuestionId: string;
    let maxPoints: number;

    it('should find an instance question with no submission', async function () {
      const row = await sqldb.queryRow(
        sql.select_unanswered_instance_question,
        { assessment_instance_id: '1' },
        z.object({
          id: IdSchema,
          qid: z.string(),
          max_points: z.coerce.number(),
          max_manual_points: z.coerce.number(),
          max_auto_points: z.coerce.number(),
        }),
      );
      unansweredInstanceQuestionId = row.id;
      maxPoints = row.max_points;
      assert.isString(unansweredInstanceQuestionId);
      assert.isAbove(maxPoints, 0);
    });

    it('should have no submission before grading', async function () {
      const submissions = await sqldb.queryRows(
        sql.select_submissions_for_instance_question,
        { instance_question_id: unansweredInstanceQuestionId },
        SubmissionSchema,
      );
      assert.lengthOf(submissions, 0);
    });

    it('should be in the "unanswered" state before grading', async function () {
      const instanceQuestion = await sqldb.queryRow(
        sql.select_instance_question,
        { instance_question_id: unansweredInstanceQuestionId },
        InstanceQuestionSchema,
      );
      assert.equal(instanceQuestion.status, 'unanswered');
      assert.isNull(instanceQuestion.last_grader);
    });

    it('should render an edit-question-points form for the unanswered question', async function () {
      const res = await fetch(locals.instructorAssessmentInstanceUrl);
      assert.equal(res.status, 200);
      locals.$ = cheerio.load(await res.text());

      // The edit-points button carries the form (with the instance_question_id) in its
      // `data-bs-content` popover. Pick the button whose form targets the unanswered question.
      const buttonEl = locals
        .$('#instanceQuestionList button[data-testid="edit-question-points-score-button-points"]')
        .filter((_i, el) => {
          const content = locals.$(el).attr('data-bs-content') ?? '';
          return content.includes(`value="${unansweredInstanceQuestionId}"`);
        });
      assert.lengthOf(buttonEl, 1);

      locals.data$ = cheerio.load(buttonEl[0].attribs['data-bs-content']);

      const csrf = locals.data$('form input[name="__csrf_token"]');
      assert.lengthOf(csrf, 1);
      locals.__csrf_token = csrf[0].attribs.value;

      const action = locals.data$('form input[name="__action"]');
      assert.lengthOf(action, 1);
      assert.equal(action[0].attribs.value, 'edit_question_points');
      locals.__action = action[0].attribs.value;

      const iqInput = locals.data$('form input[name="instance_question_id"]');
      assert.lengthOf(iqInput, 1);
      assert.equal(iqInput[0].attribs.value, unansweredInstanceQuestionId);

      assert.lengthOf(locals.data$('form input[name="points"]'), 1);
    });

    it('should accept a manual points edit with no submission', async function () {
      const form = locals.data$('form');
      const res = await fetch(locals.instructorAssessmentInstanceUrl, {
        method: 'POST',
        body: new URLSearchParams({
          __action: locals.__action,
          __csrf_token: locals.__csrf_token,
          instance_question_id: unansweredInstanceQuestionId,
          modified_at: form.find('input[name="modified_at"]').attr('value') ?? '',
          points: `${gradedPoints}`,
        }),
      });
      assert.equal(res.status, 200);
    });

    it('should record the points on the instance question', async function () {
      const instanceQuestion = await sqldb.queryRow(
        sql.select_instance_question,
        { instance_question_id: unansweredInstanceQuestionId },
        InstanceQuestionSchema,
      );
      assert.equal(instanceQuestion.points, gradedPoints);
      // With no auto points, all of the awarded points are manual points.
      assert.equal(instanceQuestion.manual_points, gradedPoints);
      assert.closeTo(instanceQuestion.score_perc ?? 0, (gradedPoints / maxPoints) * 100, 0.01);
      // The edit is attributed to the grader (the dev user) even though there is no submission.
      assert.isNotNull(instanceQuestion.last_grader);
      assert.isFalse(instanceQuestion.requires_manual_grading);
      // An unanswered question stays unanswered even after the points are edited.
      assert.equal(instanceQuestion.status, 'unanswered');
    });

    it('should not have created a submission', async function () {
      const submissions = await sqldb.queryRows(
        sql.select_submissions_for_instance_question,
        { instance_question_id: unansweredInstanceQuestionId },
        SubmissionSchema,
      );
      assert.lengthOf(submissions, 0);
    });

    it('should not have created a grading job', async function () {
      const gradingJobs = await sqldb.queryRows(
        sql.select_grading_jobs_for_instance_question,
        { instance_question_id: unansweredInstanceQuestionId },
        GradingJobSchema,
      );
      assert.lengthOf(gradingJobs, 0);
    });
  });
});
