import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as sqldb from '@prairielearn/postgres';

import * as helperDb from '../tests/helperDb.js';

const DROP_MIGRATION = '20260607153243_file_edits__did_save__did_sync__drop';

async function fileEditsColumnExists(column: string): Promise<boolean> {
  return await sqldb.queryScalar(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_name = 'file_edits'
         AND column_name = $column
     )`,
    { column },
    z.boolean(),
  );
}

describe('drop file_edits.did_save and did_sync migration', () => {
  it('removes the did_save and did_sync columns', async () => {
    await helperDb.testMigration({
      name: DROP_MIGRATION,
      beforeMigration: async () => {
        // Precondition: both columns exist before the drop migration runs.
        expect(await fileEditsColumnExists('did_save')).toBe(true);
        expect(await fileEditsColumnExists('did_sync')).toBe(true);
      },
      afterMigration: async () => {
        // After the migration, both columns must be gone.
        expect(await fileEditsColumnExists('did_save')).toBe(false);
        expect(await fileEditsColumnExists('did_sync')).toBe(false);
      },
    });
  });
});
