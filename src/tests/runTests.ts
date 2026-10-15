/**
 * @file src/tests/runTests.ts
 * @description CLI runner for the automated contract & state evaluation test suite.
 */

import { runAllContractAndStateTests } from './contractAndState.test';

const summary = runAllContractAndStateTests();

console.log('==============================================================');
console.log(`dot Mission Control — Automated Verification Suite`);
console.log(`Tests Passed: ${summary.passedTests}/${summary.totalTests} (${summary.totalAssertions} assertions)`);
console.log('==============================================================');

for (const res of summary.results) {
  const status = res.passed ? '[PASS]' : '[FAIL]';
  console.log(`${status} ${res.id}: ${res.name} (${res.assertionsRun} assertions)`);
  console.log(`       -> ${res.details}`);
  if (res.error) {
    console.error(`       !! ${res.error}`);
  }
}

if (!summary.allPassed) {
  process.exit(1);
}
