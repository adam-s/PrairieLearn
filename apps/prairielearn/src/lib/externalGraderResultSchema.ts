import { z } from 'zod';

/**
 * Zod schema for the result of an external grading job, i.e. the "envelope"
 * produced by `grader-host` (`apps/grader-host/src/index.ts`, the
 * `GradingResults` interface) in production and mirrored by
 * `ExternalGraderLocal` in local development.
 *
 * The contract is deliberately permissive: the only structurally-required field
 * is `succeeded`. Everything else is optional/nullable because real graders
 * legitimately omit timing fields, send `results: null` on failure, or attach
 * arbitrary extra data. The inner `results` object is intentionally open-ended
 * — per `docs/externalGrading.md`, course code "may add any additional data to
 * that object" — so only the fields PrairieLearn actually interprets (`score`,
 * `gradable`, `format_errors`) are typed and the rest passes through. Unknown
 * top-level keys are likewise tolerated, since the whole envelope is stored
 * verbatim as `feedback`.
 *
 * Times are typed as strings because the envelope is delivered as JSON (over
 * SQS in production, where `grader-host`'s `Date` fields serialize to ISO
 * strings; local development emits ISO strings directly).
 */
export const ExternalGradingResultsSchema = z
  .object({
    succeeded: z.boolean(),
    received_time: z.string().nullish(),
    start_time: z.string().nullish(),
    end_time: z.string().nullish(),
    job_id: z.string().nullish(),
    timedOut: z.boolean().nullish(),
    message: z.string().nullish(),
    results: z
      .object({
        // The only field with a real contract when the submission is gradable.
        // `null` is permitted for non-gradable submissions; the value is
        // range/finiteness-checked downstream, not here.
        score: z.number().nullish(),
        gradable: z.boolean().nullish(),
        // A single message or a list of messages; normalized downstream.
        format_errors: z.union([z.string(), z.array(z.string())]).nullish(),
      })
      // Course code may attach arbitrary extra fields (tests, output, images,
      // message, …) — keep them all.
      .catchall(z.any())
      .nullish(),
  })
  // The whole envelope is surfaced to students as `feedback`, so preserve any
  // additional top-level keys a grader may include.
  .catchall(z.any());

export type ExternalGradingResults = z.infer<typeof ExternalGradingResultsSchema>;
