/**
 * @file src/tests/runTests.ts
 * @description CLI runner executing both synchronous Fixture/Evaluator/UI tests
 * and asynchronous Mocked-HTTP Transport & Timeout regression tests.
 */

import {
  runAllContractAndStateTests,
  runAsyncTransportTests,
} from './contractAndState.test';

async function main() {
  const syncSummary = runAllContractAndStateTests();
  const asyncSummary = await runAsyncTransportTests();

  const allResults = [...syncSummary.results, ...asyncSummary.results];
  const totalTests = syncSummary.totalTests + asyncSummary.totalTests;
  const passedTests = syncSummary.passedTests + asyncSummary.passedTests;
  const totalAssertions = syncSummary.totalAssertions + asyncSummary.totalAssertions;

  console.log('======================================================================');
  console.log('dot Mission Control — Regression & Verification Suite');
  console.log(
    `Tests Passed: ${passedTests}/${totalTests} (${totalAssertions} assertions across Fixture, Transport & UI suites)`
  );
  console.log('Real Local Mission Control Integration: UNVERIFIED (Cloud Sandbox Build)');
  console.log('======================================================================');

  for (const res of allResults) {
    const status = res.passed ? '[PASS]' : '[FAIL]';
    console.log(
      `${status} [${res.scope}] ${res.id}: ${res.name} (${res.assertionsRun} assertions)`
    );
    console.log(`       -> ${res.details}`);
    if (res.error) {
      console.error(`       !! ${res.error}`);
    }
  }

  if (!syncSummary.allPassed || !asyncSummary.allPassed) {
    process.exit(1);
  }
}

void main();
