import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { afterAll, assert, beforeAll, describe, it } from 'vitest';

import { config } from '../lib/config.js';

import * as helperServer from './helperServer.js';

const siteUrl = 'http://localhost:' + config.serverPort;
const baseUrl = siteUrl + '/pl';
const courseInstanceUrl = baseUrl + '/course_instance/1';
const MISSING_ASSESSMENT_ID = 99999999;

// Regression for PrairieLearn/PrairieLearn#14697 (and the related #14834): the student
// "Assessment unavailable" access page must not be shown on instructor routes — those
// should get a standard error. selectAndAuthzAssessment guards both route types.
describe('selectAndAuthzAssessment access errors by route type', { timeout: 30_000 }, () => {
  beforeAll(helperServer.before());
  afterAll(helperServer.after);

  it('instructor route to a missing assessment returns a standard 404, not the student page', async () => {
    const res = await fetch(
      `${courseInstanceUrl}/instructor/assessment/${MISSING_ASSESSMENT_ID}/settings`,
    );
    assert.equal(res.status, 404);
    const $ = cheerio.load(await res.text());
    assert.notInclude($('body').text(), 'Assessment unavailable');
  });

  it('student route to an inaccessible assessment still shows the student page', async () => {
    const res = await fetch(`${courseInstanceUrl}/assessment/${MISSING_ASSESSMENT_ID}`);
    assert.equal(res.status, 403);
    const $ = cheerio.load(await res.text());
    assert.include($('body').text(), 'Assessment unavailable');
  });
});
