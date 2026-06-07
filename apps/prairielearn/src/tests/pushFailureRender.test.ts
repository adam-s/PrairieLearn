// Renders the real edit-error page component for the pre-fix outcome
// (`save_failed`) and the post-fix outcome (`push_failed`) and asserts the
// user-facing message. A failed `git push` must produce a push-specific,
// actionable message rather than the generic edit-failure message (issue #13380).
import { strict as assert } from 'node:assert';

import * as cheerio from 'cheerio';
import { afterAll, beforeAll, describe, it } from 'vitest';

import * as assets from '../lib/assets.js';
import type { EditOutcome } from '../lib/editors.js';
import { EditError } from '../pages/editError/editError.html.js';

function renderEditErrorMessage(outcome: EditOutcome): string {
  const html = EditError({
    resLocals: {
      course: { id: '1', short_name: 'TEST 101' },
      __csrf_token: 'test-token',
      authz_data: { user: { name: 'Instructor', uid: 'instructor@example.com' } },
      authn_user: { name: 'Instructor', uid: 'instructor@example.com' },
      authn_is_administrator: false,
      is_administrator: false,
      news_item_notification_count: 0,
      urlPrefix: '/pl/course/1',
      navbarType: 'instructor',
      navPage: 'course_admin',
      access_as_administrator: false,
      viewType: 'instructor',
      homeUrl: '/pl',
    } as any,
    jobSequence: {
      id: '1',
      status: 'Error',
      legacy: false,
      jobs: [{ id: '1', data: {}, output: 'Failed to push changes to remote git repository' }],
    } as any,
    outcome,
  }).toString();
  return cheerio.load(html)('.card-body').text().replace(/\s+/g, ' ').trim();
}

describe('edit-error page message for a push failure (issue #13380)', () => {
  beforeAll(async () => {
    await assets.init();
  });
  afterAll(async () => {
    await assets.close();
  });

  it('shows the generic message for a non-push save failure', () => {
    const message = renderEditErrorMessage('save_failed');
    assert.doesNotMatch(message, /push|GitHub/i);
    assert.match(message, /did not complete successfully/i);
  });

  it('shows a push-specific, actionable message for a push failure', () => {
    const message = renderEditErrorMessage('push_failed');
    assert.match(message, /could not be pushed to the remote GitHub repository/i);
    assert.match(message, /not saved/i);
    assert.match(message, /reset to the version currently on GitHub/i);
  });
});
