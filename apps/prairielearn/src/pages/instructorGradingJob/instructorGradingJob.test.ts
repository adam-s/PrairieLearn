import * as cheerio from 'cheerio';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';

import * as assets from '../../lib/assets.js';

import { type GradingJobRow, InstructorGradingJob } from './instructorGradingJob.html.js';

// Bare-minimum resLocals to render the page programmatically (mirrors the
// approach in authLogin.test.ts, which renders a *.html.ts page directly).
const resLocals: any = {
  urlPrefix: '/pl/course/1',
  course: {
    id: '1',
    short_name: 'TEST 101',
    display_timezone: 'America/Chicago',
    example_course: false,
  },
  authz_data: {
    has_course_permission_view: true,
    user: { name: 'Instructor', uid: 'instructor@example.com' },
  },
};

function makeRow(overrides: Partial<GradingJobRow['grading_job']> = {}): GradingJobRow {
  return {
    grading_job: {
      id: '42',
      grading_requested_at: new Date('2024-01-01T00:00:00Z'),
      grading_submitted_at: new Date('2024-01-01T00:00:01Z'),
      grading_received_at: new Date('2024-01-01T00:00:02Z'),
      grading_started_at: new Date('2024-01-01T00:00:03Z'),
      grading_finished_at: new Date('2024-01-01T00:00:04Z'),
      graded_at: new Date('2024-01-01T00:00:05Z'),
      s3_bucket: null,
      s3_root_key: null,
      output: 'some output',
      ...overrides,
    },
    question_id: '1',
    question_qid: 'addNumbers',
    user_uid: 'student@example.com',
    variant_id: '1',
    instance_question_id: null,
    course_instance_id: null,
  } as unknown as GradingJobRow;
}

/** All heading tags (h1-h6), in document order, as their numeric level. */
function headingOutline($: cheerio.CheerioAPI): { level: number; text: string }[] {
  return $('h1, h2, h3, h4, h5, h6')
    .toArray()
    .map((el) => ({
      level: Number(el.tagName.slice(1)),
      text: $(el).text().trim(),
    }));
}

describe('instructorGradingJob heading structure', () => {
  // Bare minimum to render the page programmatically.
  beforeAll(() => assets.init());
  afterAll(() => assets.close());

  it('has exactly one h1', () => {
    const $ = cheerio.load(InstructorGradingJob({ resLocals, gradingJobRow: makeRow() }));
    assert.lengthOf($('h1').toArray(), 1, 'page must have exactly one <h1>');
  });

  it('renders the "Job Output" card header as a semantic heading', () => {
    const $ = cheerio.load(InstructorGradingJob({ resLocals, gradingJobRow: makeRow() }));
    const headings = headingOutline($).map((h) => h.text);
    assert.include(headings, 'Job Output', '"Job Output" card header must be a heading element');
  });

  it('renders the "Downloads" card header as a semantic heading when downloads are present', () => {
    const $ = cheerio.load(
      InstructorGradingJob({
        resLocals,
        gradingJobRow: makeRow({ s3_bucket: 'bucket', s3_root_key: 'key' }),
      }),
    );
    const headings = headingOutline($).map((h) => h.text);
    assert.include(headings, 'Downloads', '"Downloads" card header must be a heading element');
  });

  it('produces a heading outline with no skipped levels', () => {
    // With downloads present, all three cards are rendered.
    const $ = cheerio.load(
      InstructorGradingJob({
        resLocals,
        gradingJobRow: makeRow({ s3_bucket: 'bucket', s3_root_key: 'key' }),
      }),
    );
    const outline = headingOutline($);

    // Restrict to the page's own content headings (the card headers), excluding
    // any heading the surrounding layout might contribute.
    const contentHeadings = outline.filter((h) =>
      ['Grading Job 42', 'Downloads', 'Job Output'].includes(h.text),
    );
    const levels = contentHeadings.map((h) => h.level);

    // No level should jump by more than one from the previous heading.
    for (let i = 1; i < levels.length; i++) {
      assert.isAtMost(
        levels[i] - levels[i - 1],
        1,
        `heading level jumps from h${levels[i - 1]} to h${levels[i]} (skipped level): ${JSON.stringify(
          contentHeadings,
        )}`,
      );
    }

    // The expected outline established by #10483: h1 page title, then one h2 per card.
    assert.deepEqual(
      levels,
      [1, 2, 2],
      `unexpected heading outline: ${JSON.stringify(contentHeadings)}`,
    );
  });
});
