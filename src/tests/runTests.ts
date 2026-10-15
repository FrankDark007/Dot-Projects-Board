/**
 * @file src/tests/runTests.ts
 * @description CLI runner for the synchronous and asynchronous verification suites.
 * Initializes a lightweight W3C DOM environment (`happy-dom`) when run in Node CLI
 * so mounted React 19 (`createRoot` + `act`) browser interaction tests execute natively.
 */

import { Window } from 'happy-dom';
import {
  runAllContractAndStateTests,
  runAsyncTransportTests,
} from './contractAndState.test';

// Set up DOM globals for mounted React 19 UI interaction tests when running in Node CLI
if (typeof globalThis.document === 'undefined') {
  const happyWindow = new Window({ url: 'http://localhost:3000/' });
  Object.assign(globalThis, {
    window: happyWindow,
    document: happyWindow.document,
    HTMLElement: happyWindow.HTMLElement,
    HTMLInputElement: happyWindow.HTMLInputElement,
    HTMLSelectElement: happyWindow.HTMLSelectElement,
    HTMLButtonElement: happyWindow.HTMLButtonElement,
    Event: happyWindow.Event,
    MouseEvent: happyWindow.MouseEvent,
    KeyboardEvent: happyWindow.KeyboardEvent,
    Node: happyWindow.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: happyWindow.navigator,
    configurable: true,
    writable: true,
  });
} else {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
}

async function main() {
  const syncSummary = runAllContractAndStateTests();
  const asyncSummary = await runAsyncTransportTests();

  const allResults = [...syncSummary.results, ...asyncSummary.results];
  const passedTests = allResults.filter((r) => r.passed).length;
  const totalTests = allResults.length;
  const totalAssertions = allResults.reduce((acc, r) => acc + r.assertionsRun, 0);

  console.log('======================================================================');
  console.log('dot Mission Control — Regression & Verification Suite');
  console.log(
    `Tests Passed: ${passedTests}/${totalTests} (${totalAssertions} assertions across Fixture, Transport & Mounted UI suites)`
  );
  console.log('Real Local Mission Control Integration: UNVERIFIED (Cloud Sandbox Build)');
  console.log('======================================================================');

  for (const res of allResults) {
    const badge = res.passed ? '[PASS]' : '[FAIL]';
    console.log(
      `${badge} [${res.scope}] ${res.id}: ${res.name} (${res.assertionsRun} assertions)`
    );
    if (res.passed) {
      console.log(`       -> ${res.details}`);
    } else {
      console.error(`       -> ERROR: ${res.error}`);
    }
  }

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

void main();
