import { afterEach, assert, beforeEach, describe, it } from 'vitest';

import { queryRows, queryRow } from '@prairielearn/postgres';

import { UserSchema } from '../lib/db-types.js';
import * as helperDb from '../tests/helperDb.js';
import { getOrCreateUser } from '../tests/utils/auth.js';

import { selectOptionalUserByUid, selectOrInsertUserByUid } from './user.js';

describe('user model UID case handling (issue #5757)', () => {
  beforeEach(async function () {
    await helperDb.before();
  });

  afterEach(async function () {
    await helperDb.after();
  });

  it('selectOrInsertUserByUid matches an existing user regardless of case', async () => {
    // Seed a user whose UID is mixed-case (e.g. some SSO providers / autocapitalize).
    const existing = await getOrCreateUser({
      uid: 'Foo-5757@example.com',
      name: 'Foo 5757',
      uin: 'uin-5757',
      email: 'Foo-5757@example.com',
    });

    // An instructor adds the same person typing the UID in lower case.
    const found = await selectOrInsertUserByUid('foo-5757@example.com');

    // It MUST return the existing user, not create a duplicate orphan row.
    assert.equal(found.id, existing.id);

    const rows = await queryRows(
      "SELECT * FROM users WHERE lower(uid) = 'foo-5757@example.com'",
      {},
      UserSchema,
    );
    assert.lengthOf(rows, 1);
  });

  it('selectOptionalUserByUid finds an existing user regardless of case', async () => {
    const existing = await getOrCreateUser({
      uid: 'Bar-5757@example.com',
      name: 'Bar 5757',
      uin: 'uin-bar-5757',
      email: 'Bar-5757@example.com',
    });

    const found = await selectOptionalUserByUid('BAR-5757@example.com');
    assert.isNotNull(found);
    assert.equal(found?.id, existing.id);
  });

  it('selectOrInsertUserByUid still inserts a new user when none matches', async () => {
    const before = await selectOptionalUserByUid('brand-new-5757@example.com');
    assert.isNull(before);

    const created = await selectOrInsertUserByUid('brand-new-5757@example.com');
    assert.equal(created.uid, 'brand-new-5757@example.com');

    // Calling again with a different case returns the SAME row (no duplicate).
    const again = await selectOrInsertUserByUid('Brand-New-5757@example.com');
    assert.equal(again.id, created.id);
  });

  it('stays deterministic and prefers exact case with pre-existing case-variant rows', async () => {
    // Legacy data: two users that differ only by case already exist (the broken
    // state the bug used to create). A case-insensitive lookup must NOT throw on
    // multiple matches; it must deterministically prefer the exact-case row.
    const upper = await queryRow(
      "INSERT INTO users (uid, name) VALUES ('Dup-5757@example.com', 'Upper') RETURNING *",
      {},
      UserSchema,
    );
    const lower = await queryRow(
      "INSERT INTO users (uid, name) VALUES ('dup-5757@example.com', 'lower') RETURNING *",
      {},
      UserSchema,
    );

    const exact = await selectOptionalUserByUid('dup-5757@example.com');
    assert.equal(exact?.id, lower.id);

    const exactUpper = await selectOptionalUserByUid('Dup-5757@example.com');
    assert.equal(exactUpper?.id, upper.id);

    // No exact-case match -> falls back to the oldest matching row, never throws.
    const noExact = await selectOptionalUserByUid('DUP-5757@example.com');
    assert.equal(noExact?.id, upper.id);
  });
});
