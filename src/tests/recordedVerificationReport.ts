/**
 * @file src/tests/recordedVerificationReport.ts
 * @description Provides isolated, recorded verification results from the dev/test runner
 * (`npx tsx src/tests/runTests.ts`) so the operational Contract & Tests view never executes
 * the async fake-timer harness (`withFakeTimers`) on the live dashboard page or replaces
 * `globalThis.setTimeout`, `globalThis.clearTimeout`, `globalThis.setInterval`, `globalThis.fetch`,
 * or clears queued live polling work.
 */

import recordedJson from './recordedVerificationReport.json';
import type { TestCaseResult } from './contractAndState.test';

export interface RecordedAsyncVerificationReport {
  schemaVersion: 'dot.verification-report.v1';
  recordedAt: string;
  runnerCommand: string;
  executionIsolation: 'dev_test_runner_recorded';
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  totalAssertions: number;
  results: TestCaseResult[];
}

export function getBundledRecordedAsyncVerificationReport(): RecordedAsyncVerificationReport {
  return recordedJson as unknown as RecordedAsyncVerificationReport;
}

export async function loadRecordedAsyncVerificationReport(): Promise<RecordedAsyncVerificationReport> {
  // Resolve asynchronously without touching global timers, clock, or live polling fetch
  await Promise.resolve();
  return getBundledRecordedAsyncVerificationReport();
}
