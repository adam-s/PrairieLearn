// Reproduction + regression test for upstream issue #13380:
// "Improve reliability when git push fails".
//
// When an instructor edits course content through the UI, PL writes + commits
// locally and pushes to the course's git remote. If the push fails (GitHub
// outage, rejected push, network error), the edit must end in a *deterministic,
// self-consistent* state: the local repo, the database, and the stored
// commit hash must all agree, and the edit must be reported as failed (so the
// instructor knows their change did not persist) rather than silently appearing
// to have been kept.
import { strict as assert } from 'node:assert';
import * as path from 'node:path';

import { execa } from 'execa';
import fs from 'fs-extra';
import { afterAll, beforeAll, describe, it } from 'vitest';

import * as sqldb from '@prairielearn/postgres';

import { config } from '../lib/config.js';
import { JobSequenceSchema, UserSchema } from '../lib/db-types.js';
import { FileModifyEditor, classifyEditOutcome } from '../lib/editors.js';
import { computeFileContentHash } from '../lib/editorUtil.js';
import { getJobSequence } from '../lib/server-jobs.js';
import { b64EncodeUnicode } from '../lib/base64-util.js';
import { selectCourseById } from '../models/course.js';

import {
  type CourseRepoFixture,
  createCourseRepoFixture,
  updateCourseRepository,
} from './helperCourse.js';
import * as helperServer from './helperServer.js';

const sql = sqldb.loadSqlEquiv(import.meta.url);

const courseTemplateDir = path.join(import.meta.dirname, 'testFileEditor', 'courseTemplate');

let courseRepo: CourseRepoFixture;

/**
 * Install a pre-receive hook in the origin repo that rejects every push,
 * emulating a GitHub outage / rejected push.
 */
async function makeRemoteRejectPushes(originDir: string) {
  const hooksDir = path.join(originDir, '.git', 'hooks');
  await fs.ensureDir(hooksDir);
  const hookPath = path.join(hooksDir, 'pre-receive');
  await fs.writeFile(hookPath, '#!/bin/sh\necho "remote: simulated push rejection" 1>&2\nexit 1\n');
  await fs.chmod(hookPath, 0o755);
}

async function gitHead(dir: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: dir });
  return stdout.trim();
}

async function gitRemoteHead(dir: string, branch: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', `origin/${branch}`], { cwd: dir });
  return stdout.trim();
}

describe('git push failure during a file edit (issue #13380)', { timeout: 30_000 }, () => {
  let originalUseGit: boolean;

  beforeAll(async () => {
    courseRepo = await createCourseRepoFixture(courseTemplateDir);
    await helperServer.before(courseRepo.courseLiveDir)();
    await updateCourseRepository({ courseId: '1', repository: courseRepo.courseOriginDir });
    // Force the git path (production behaviour) even though tests run "locally".
    originalUseGit = config.fileEditorUseGit;
    config.fileEditorUseGit = true;
  });

  afterAll(async () => {
    config.fileEditorUseGit = originalUseGit;
    await helperServer.after();
  });

  it('leaves the repo, DB, and commit hash consistent and reports failure', async () => {
    const course = await selectCourseById('1');
    const user = await sqldb.queryRow(sql.select_user, {}, UserSchema);

    const remoteHeadBefore = await gitRemoteHead(courseRepo.courseLiveDir, course.branch!);

    // Make every push to the origin fail.
    await makeRemoteRejectPushes(courseRepo.courseOriginDir);

    const infoCoursePath = path.join(courseRepo.courseLiveDir, 'infoCourse.json');
    const origContents = await fs.readFile(infoCoursePath, 'utf8');
    const origHash = computeFileContentHash(origContents);
    const edited = origContents.replace(
      /"name"\s*:\s*"[^"]*"/,
      '"name": "EDITED_BY_PUSH_FAIL_TEST"',
    );
    assert.notEqual(edited, origContents, 'edit must actually change the file');

    const editor = new FileModifyEditor({
      locals: {
        course,
        user,
        authz_data: { has_course_permission_edit: true, authn_user: user },
      } as any,
      container: { rootPath: courseRepo.courseLiveDir, invalidRootPaths: [] },
      filePath: infoCoursePath,
      editContents: b64EncodeUnicode(edited),
      origHash,
    });

    const serverJob = await editor.prepareServerJob();
    let threw = false;
    try {
      await editor.executeWithServerJob(serverJob);
    } catch {
      threw = true;
    }

    // ---- Observe the resulting state ----
    const localHeadAfter = await gitHead(courseRepo.courseLiveDir);
    const remoteHeadAfter = await gitRemoteHead(courseRepo.courseLiveDir, course.branch!);
    const diskContents = await fs.readFile(infoCoursePath, 'utf8');
    const courseAfter = await selectCourseById('1');

    const jobSeq = await sqldb.queryRow(sql.select_last_job_sequence, JobSequenceSchema);
    const jobSequence = await getJobSequence(jobSeq.id, '1');
    const data = jobSequence.jobs[0].data as Record<string, unknown>;
    const outcome = classifyEditOutcome(data);

    // ---- The invariants this issue is about ----
    // The edit fails (push could not complete).
    assert.equal(threw, true, 'a failed push must surface as a thrown error');

    // 1. The remote was never updated (push failed).
    assert.equal(remoteHeadAfter, remoteHeadBefore, 'remote must be unchanged when push fails');

    // 2. The local commit was discarded; disk is back to the remote version, and
    //    the local repo HEAD and the DB commit hash agree (single source of truth).
    assert.ok(
      !diskContents.includes('EDITED_BY_PUSH_FAIL_TEST'),
      'the edit must be discarded on disk',
    );
    assert.equal(courseAfter.commit_hash, localHeadAfter, 'DB commit_hash must match local HEAD');

    // 3. The edit must be reported as a *push* failure, not a generic save
    //    failure, so the instructor gets an accurate, actionable message
    //    (retry once GitHub is reachable) rather than the generic "the file
    //    edit did not complete successfully". Before the fix this classified as
    //    the generic `save_failed`.
    assert.equal(data.pushFailed, true, 'a failed push must set pushFailed');
    assert.equal(outcome, 'push_failed', 'a failed push must classify as push_failed');
    assert.equal(
      jobSequence.status,
      'Error',
      'the job sequence must surface the failure as an error',
    );
  });
});
