import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import * as helperDb from '../tests/helperDb.js';

const DROP_MIGRATION = '20260607164500_submissions__regradable__drop';

async function submissionsColumnExists(column: string): Promise<boolean> {
  return await sqldb.queryScalar(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'submissions'
         AND column_name = $column
     )`,
    { column },
    z.boolean(),
  );
}

describe('drop submissions.regradable migration', () => {
  it('removes the regradable column', async () => {
    await helperDb.testMigration({
      name: DROP_MIGRATION,
      beforeMigration: async () => {
        // Precondition: the column exists before the drop migration runs.
        expect(await submissionsColumnExists('regradable')).toBe(true);
      },
      afterMigration: async () => {
        // After the migration, the column must be gone.
        expect(await submissionsColumnExists('regradable')).toBe(false);
      },
    });
  });
});
