import { describe, expect, it } from 'vitest';

import { getDetailsForFile } from '../lib/editorUtil.js';
import {
  type AssessmentInfo,
  type CourseInstanceInfo,
  type QuestionInfo,
} from '../lib/editorUtil.shared.js';

describe('editor library', () => {
  it('gets details for course info file', () => {
    const details = getDetailsForFile('infoCourse.json');
    expect(details.type).toBe('course');
  });

  it('gets details for course instance info file', () => {
    const details = getDetailsForFile(
      'courseInstances/testinstance/infoCourseInstance.json',
    ) as CourseInstanceInfo;
    expect(details.type).toBe('courseInstance');
    expect(details.ciid).toBe('testinstance');
  });

  it('gets details for question info', () => {
    const details = getDetailsForFile('questions/testquestion/info.json') as QuestionInfo;
    expect(details.type).toBe('question');
    expect(details.qid).toBe('testquestion');
  });

  it('gets details for assessment info file', () => {
    const details = getDetailsForFile(
      'courseInstances/testinstance/assessments/testassessment/infoAssessment.json',
    ) as AssessmentInfo;
    expect(details.type).toBe('assessment');
    expect(details.ciid).toBe('testinstance');
    expect(details.aid).toBe('testassessment');
  });
});
