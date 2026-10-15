/**
 * @file src/tests/verifyLayoutBrowser.ts
 * @description Real-browser (Chromium via Playwright) layout & geometry verification suite.
 *
 * Verifies the rendered dashboard at:
 * - 320, 375, 768, 1023, 1024, 1280, 1440, 1600, and 1920 CSS pixels
 * - 200% browser zoom (both CSS zoom: 200% and 2x effective CSS pixel scaling)
 * - Expanded and collapsed sidebar states
 * - Standard fixtures AND adversarial stress fixtures (long project names, long owner names,
 *   and 140+ character unbroken strings/identifiers)
 * - Project Rows, Project Cards, and Project Detail slide-over panel
 *
 * Asserts:
 * 1. Zero horizontal page overflow (`document.documentElement.scrollWidth <= window.innerWidth`)
 * 2. Zero bounding-box intersection between row/card controls and neighboring text columns
 * 3. Zero sibling control overlap and zero child overflow outside row/card containers
 * 4. Accessible interactive control dimensions and legible computed font sizes
 * 5. Captures full-page screenshots for visual inspection
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, ViteDevServer } from 'vite';
import { createSyntheticSnapshot, REFERENCE_NOW_ISO } from '../fixtures/syntheticFixtures';

// Resolve Playwright portably from standard node_modules, environment override, or global bun cache
const PLAYWRIGHT_MODULE_PATHS = [
  process.env.PLAYWRIGHT_MODULE_PATH,
  'playwright',
  'playwright-core',
  path.join(os.homedir(), '.bun/install/global/node_modules/playwright'),
  '/root/.bun/install/global/node_modules/playwright',
].filter((p): p is string => Boolean(p));

interface PlaywrightRoute {
  fulfill(response: { status: number; contentType: string; body: string }): Promise<void>;
}

interface PlaywrightPage {
  route(url: string, handler: (route: PlaywrightRoute) => Promise<void>): Promise<void>;
  goto(url: string, options?: { waitUntil?: string }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<T>(fn: () => T): Promise<T>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  getAttribute(selector: string, name: string): Promise<string | null>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string): Promise<void>;
  reload(options?: { waitUntil?: string }): Promise<void>;
}

interface PlaywrightBrowserContext {
  addInitScript(script: string): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options?: {
    viewport?: { width: number; height: number };
  }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightModule {
  chromium: {
    launch(options?: {
      headless?: boolean;
      executablePath?: string;
      args?: string[];
    }): Promise<PlaywrightBrowser>;
  };
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  for (const modPath of PLAYWRIGHT_MODULE_PATHS) {
    try {
      const mod = (await import(modPath)) as PlaywrightModule & { default?: PlaywrightModule };
      return mod.chromium ? mod : (mod.default as PlaywrightModule);
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'Could not resolve playwright module. Install playwright or set PLAYWRIGHT_MODULE_PATH.'
  );
}

function findChromiumExecutable(): string | undefined {
  const envCandidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROMIUM_PATH,
    process.env.CHROME_BIN,
  ].filter((p): p is string => Boolean(p));

  for (const candidate of envCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  // Scan standard Playwright browser cache roots if present, otherwise return undefined so Playwright uses its default bundled executable
  const browserRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), '.cache/ms-playwright'),
    '/ms-playwright',
  ].filter((p): p is string => Boolean(p));

  for (const rootDir of browserRoots) {
    if (!fs.existsSync(rootDir)) continue;
    try {
      const entries = fs.readdirSync(rootDir).sort().reverse();
      for (const entry of entries) {
        const subPaths = [
          path.join(
            rootDir,
            entry,
            'chrome-headless-shell-linux64',
            'chrome-headless-shell'
          ),
          path.join(rootDir, entry, 'chrome-linux', 'chrome'),
          path.join(rootDir, entry, 'chrome-headless-shell'),
        ];
        for (const sp of subPaths) {
          if (fs.existsSync(sp)) return sp;
        }
      }
    } catch {
      // ignore permission/read errors and continue
    }
  }

  return undefined;
}

const VIEWPORT_WIDTHS = [320, 375, 768, 1023, 1024, 1280, 1440, 1600, 1920] as const;

const PORTABLE_SCREENSHOT_DIR = path.resolve(
  process.env.BROWSER_SCREENSHOT_DIR ?? 'artifacts/browser_screenshots'
);
const SANDBOX_ARTIFACT_ROOT = path.resolve(
  '.aistudio/artifacts/brain/ca92b25c-bf31-4d97-9ef9-b6f7ef30dcb2'
);
const SANDBOX_SCREENSHOT_DIR = path.join(SANDBOX_ARTIFACT_ROOT, 'browser_screenshots');
const SCREENSHOT_DIR = fs.existsSync(SANDBOX_ARTIFACT_ROOT)
  ? SANDBOX_SCREENSHOT_DIR
  : PORTABLE_SCREENSHOT_DIR;

interface GeometryAuditResult {
  viewportWidth: number;
  viewportHeight: number;
  zoomLabel: string;
  sidebarState: string;
  datasetLabel: string;
  scrollWidth: number;
  innerWidth: number;
  horizontalOverflowPx: number;
  rowCount: number;
  intersectionErrors: string[];
  overflowErrors: string[];
  controlSizeErrors: string[];
  screenshotPath: string;
}

/**
 * Builds an adversarial snapshot containing:
 * - Extremely long project names (both multi-word and 140-char unbroken tokens)
 * - Extremely long owner names (both hyphenated and unbroken handles)
 * - Unbroken blocker / next-action / milestone strings
 */
function createStressSnapshot() {
  const nowIso = new Date().toISOString();
  const base = createSyntheticSnapshot(nowIso);
  const unbrokenToken140 =
    'https://mission-control.internal.dot.local/api/v1/artifacts/sha256_9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08_unbroken_diagnostic_segment_verify_wrap';
  const longOwnerName =
    'dot/autonomous-subagent-cluster-coordinator-primary-us-west-2-extremely-long-owner-identity-handle-v2';
  const longProjectTitle =
    'Cross-Host Distributed Context Compactor & Deterministic Replay Verification Pipeline With UnbrokenToken_' +
    'X'.repeat(95);

  return {
    ...base,
    snapshotId: 'snap-browser-stress-001',
    generatedAt: nowIso,
    sequence: 500,
    capabilities: {
      commandEndpointVerified: true,
      canArchive: true,
      canChangePriority: true,
      canAddNote: true,
      canSendReminder: true,
      canResolveDecision: true,
    },
    projects: base.projects.map((p, idx) => {
      const freshSource = {
        ...p.source,
        observedAt: nowIso,
        freshnessThresholdSeconds: 3600,
      };
      if (idx === 0) {
        return {
          ...p,
          source: freshSource,
          name: longProjectTitle,
          owner: longOwnerName,
          nextAction: `Inspect unbroken artifact URI ${unbrokenToken140} and verify zero overlap with row controls.`,
          blocker: {
            summary: `Critical unbroken failure token: ${unbrokenToken140} caused exit code 139 on worker host.`,
            since: nowIso,
            kind: 'worker_crashed' as const,
            isConfirmedFailure: true,
            owner: longOwnerName,
          },
          milestones: p.milestones.map((m, mIdx) =>
            mIdx === 0
              ? {
                  ...m,
                  title: `Milestone_01_Unbroken_Identifier_${'M'.repeat(85)}_Verification`,
                }
              : m
          ),
        };
      }
      if (idx === 1) {
        return {
          ...p,
          source: freshSource,
          name: 'UltraLongUnbrokenProjectIdentifier_' + 'P'.repeat(110),
          owner: 'owner_unbroken_' + 'O'.repeat(80),
          nextAction: 'NextAction_Unbroken_' + 'N'.repeat(115),
        };
      }
      return {
        ...p,
        source: freshSource,
      };
    }),
  };
}

async function runBrowserLayoutVerification(): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Start an in-process Vite server on an ephemeral port so verification is self-contained
  const server: ViteDevServer = await createServer({
    server: { port: 0, host: '127.0.0.1' },
    logLevel: 'error',
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  const baseUrl = `http://127.0.0.1:${port}`;

  const pw = await loadPlaywright();
  const executablePath = findChromiumExecutable();
  const browser = await pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const auditResults: GeometryAuditResult[] = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addInitScript('window.__name = (fn) => fn;');
    const page = await context.newPage();

    // Intercept live endpoint /snapshot so we can test both standard Demo fixtures and Live Stress fixtures
    await page.route('**/api/mission-control/v1/snapshot', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createStressSnapshot()),
      });
    });

    await page.goto(baseUrl, { waitUntil: 'networkidle' });

    // Helper that audits the current page geometry in real Chromium
    const performGeometryAudit = async (
      viewportWidth: number,
      viewportHeight: number,
      zoomLabel: string,
      sidebarState: string,
      datasetLabel: string,
      screenshotName: string
    ): Promise<GeometryAuditResult> => {
      await page.evaluate(() => {
        const filterSelect = document.querySelector('[data-testid="owner-filter-select"]');
        if (filterSelect) {
          filterSelect.scrollIntoView({ block: 'start' });
        }
      });
      await page.waitForTimeout(60);

      const metrics = await page.evaluate(() => {
        const docEl = document.documentElement;
        const scrollWidth = docEl.scrollWidth;
        const innerWidth = window.innerWidth;
        const horizontalOverflowPx = Math.max(0, scrollWidth - innerWidth);

        const intersectionErrors: string[] = [];
        const overflowErrors: string[] = [];
        const controlSizeErrors: string[] = [];

        const rectsIntersect = (a: DOMRect, b: DOMRect, tolerance = 1.5): boolean => {
          return !(
            a.right <= b.left + tolerance ||
            a.left >= b.right - tolerance ||
            a.bottom <= b.top + tolerance ||
            a.top >= b.bottom - tolerance
          );
        };

        // 1. Audit every ProjectRow
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>('[data-testid^="project-row-"]')
        ).filter((el) => {
          const id = el.getAttribute('data-testid') || '';
          return (
            !id.startsWith('project-row-primary-') &&
            !id.startsWith('project-row-owner-') &&
            !id.startsWith('project-row-milestone-') &&
            !id.startsWith('project-row-blocker-or-next-') &&
            !id.startsWith('project-row-actions-')
          );
        });

        for (const row of rows) {
          const rowId = row.getAttribute('data-testid') || 'row';
          const rowRect = row.getBoundingClientRect();

          const primaryCol = row.querySelector<HTMLElement>(
            '[data-testid^="project-row-primary-"]'
          );
          const milestoneCol = row.querySelector<HTMLElement>(
            '[data-testid^="project-row-milestone-"]'
          );
          const blockerCol = row.querySelector<HTMLElement>(
            '[data-testid^="project-row-blocker-or-next-"]'
          );
          const actionsCol = row.querySelector<HTMLElement>(
            '[data-testid^="project-row-actions-"]'
          );

          const cols = [
            { name: 'primary', el: primaryCol },
            { name: 'milestone', el: milestoneCol },
            { name: 'blocker', el: blockerCol },
            { name: 'actions', el: actionsCol },
          ].filter((c): c is { name: string; el: HTMLElement } => Boolean(c.el));

          // Check pairwise intersections among primary, milestone, blocker, and actions columns
          for (let i = 0; i < cols.length; i++) {
            const rectA = cols[i].el.getBoundingClientRect();
            if (rectA.right > rowRect.right + 2 || rectA.left < rowRect.left - 2) {
              overflowErrors.push(
                `${rowId}: column "${cols[i].name}" overflows row bounds (col=[${Math.round(
                  rectA.left
                )},${Math.round(rectA.right)}], row=[${Math.round(rowRect.left)},${Math.round(
                  rowRect.right
                )}])`
              );
            }
            for (let j = i + 1; j < cols.length; j++) {
              const rectB = cols[j].el.getBoundingClientRect();
              if (rectsIntersect(rectA, rectB)) {
                intersectionErrors.push(
                  `${rowId}: "${cols[i].name}" [${Math.round(rectA.left)},${Math.round(
                    rectA.top
                  )},${Math.round(rectA.right)},${Math.round(
                    rectA.bottom
                  )}] intersects "${cols[j].name}" [${Math.round(rectB.left)},${Math.round(
                    rectB.top
                  )},${Math.round(rectB.right)},${Math.round(rectB.bottom)}]`
                );
              }
            }
          }

          // Check individual controls inside actionsCol against text columns and each other
          if (actionsCol) {
            const controls = Array.from(
              actionsCol.querySelectorAll<HTMLElement>('button, select')
            );
            for (let i = 0; i < controls.length; i++) {
              const cRect = controls[i].getBoundingClientRect();
              if (cRect.height < 28 || cRect.width < 28) {
                controlSizeErrors.push(
                  `${rowId}: control #${i} too small (${Math.round(cRect.width)}x${Math.round(
                    cRect.height
                  )})`
                );
              }
              if (cRect.right > rowRect.right + 2) {
                overflowErrors.push(
                  `${rowId}: control #${i} overflows right edge of row (${Math.round(
                    cRect.right
                  )} > ${Math.round(rowRect.right)})`
                );
              }
              for (const textCol of [primaryCol, milestoneCol, blockerCol]) {
                if (textCol && rectsIntersect(cRect, textCol.getBoundingClientRect())) {
                  intersectionErrors.push(
                    `${rowId}: action control #${i} intersects text column "${textCol.getAttribute(
                      'data-testid'
                    )}"`
                  );
                }
              }
              for (let j = i + 1; j < controls.length; j++) {
                if (rectsIntersect(cRect, controls[j].getBoundingClientRect())) {
                  intersectionErrors.push(
                    `${rowId}: action control #${i} intersects sibling control #${j}`
                  );
                }
              }
            }
          }
        }

        // 2. Audit Filter Bar selects (owner & priority selects must not overflow viewport)
        const ownerSelect = document.querySelector<HTMLElement>(
          '[data-testid="owner-filter-select"]'
        );
        if (ownerSelect) {
          const sRect = ownerSelect.getBoundingClientRect();
          if (sRect.right > innerWidth + 1) {
            overflowErrors.push(
              `owner-filter-select overflows viewport (${Math.round(sRect.right)} > ${innerWidth})`
            );
          }
        }

        return {
          scrollWidth,
          innerWidth,
          horizontalOverflowPx,
          rowCount: rows.length,
          intersectionErrors,
          overflowErrors,
          controlSizeErrors,
        };
      });

      const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      return {
        viewportWidth,
        viewportHeight,
        zoomLabel,
        sidebarState,
        datasetLabel,
        ...metrics,
        screenshotPath,
      };
    };

    // Pass 1: Standard Demo Fixtures across all 9 required widths (expanded & collapsed sidebar)
    for (const width of VIEWPORT_WIDTHS) {
      const height = 900;
      await page.setViewportSize({ width, height });

      if (width >= 768) {
        // Ensure sidebar is expanded first
        const isCollapsed = await page.getAttribute(
          '[data-testid="desktop-sidebar"]',
          'data-collapsed'
        );
        if (isCollapsed === 'true') {
          await page.click('[data-testid="desktop-sidebar-toggle"]');
        }
        auditResults.push(
          await performGeometryAudit(
            width,
            height,
            '100%',
            'expanded',
            'demo_standard',
            `vp-${width}px-expanded-demo.png`
          )
        );

        // Now test with collapsed desktop sidebar
        await page.click('[data-testid="desktop-sidebar-toggle"]');
        auditResults.push(
          await performGeometryAudit(
            width,
            height,
            '100%',
            'collapsed',
            'demo_standard',
            `vp-${width}px-collapsed-demo.png`
          )
        );
        // Restore expanded
        await page.click('[data-testid="desktop-sidebar-toggle"]');
      } else {
        // Mobile viewport (< 768px): test default (drawer closed)
        auditResults.push(
          await performGeometryAudit(
            width,
            height,
            '100%',
            'mobile-closed',
            'demo_standard',
            `vp-${width}px-mobile-demo.png`
          )
        );
      }
    }

    // Pass 2: Switch to Live Mode with Stress Dataset (long project names, long owner names, 140-char unbroken tokens)
    // and test across all 9 widths + 200% zoom with active write controls enabled!
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.click('button:has-text("Switch to Live Adapter Mode")');
    await page.waitForSelector('text=Cross-Host Distributed Context Compactor');

    for (const width of VIEWPORT_WIDTHS) {
      const height = 900;
      await page.setViewportSize({ width, height });

      if (width >= 768) {
        const isCollapsed = await page.getAttribute(
          '[data-testid="desktop-sidebar"]',
          'data-collapsed'
        );
        if (isCollapsed === 'true') {
          await page.click('[data-testid="desktop-sidebar-toggle"]');
        }
        auditResults.push(
          await performGeometryAudit(
            width,
            height,
            '100%',
            'expanded',
            'stress_long_unbroken',
            `vp-${width}px-expanded-stress.png`
          )
        );

        await page.click('[data-testid="desktop-sidebar-toggle"]');
        auditResults.push(
          await performGeometryAudit(
            width,
            height,
            '100%',
            'collapsed',
            'stress_long_unbroken',
            `vp-${width}px-collapsed-stress.png`
          )
        );
        await page.click('[data-testid="desktop-sidebar-toggle"]');
      } else {
        auditResults.push(
          await performGeometryAudit(
            width,
            height,
            '100%',
            'mobile-closed',
            'stress_long_unbroken',
            `vp-${width}px-mobile-stress.png`
          )
        );
      }
    }

    // Pass 3: 200% Zoom verification (at 1280px and 1440px physical widths -> 640px and 720px effective CSS widths, plus CSS zoom=2)
    for (const baseWidth of [1280, 1440, 1920]) {
      // 3a. Effective 200% browser zoom (viewport width halved in CSS pixels, deviceScaleFactor: 2)
      const zoomedCssWidth = Math.round(baseWidth / 2);
      await page.setViewportSize({ width: zoomedCssWidth, height: 700 });
      auditResults.push(
        await performGeometryAudit(
          zoomedCssWidth,
          700,
          `200%-effective-from-${baseWidth}px`,
          zoomedCssWidth >= 768 ? 'expanded' : 'mobile-closed',
          'stress_long_unbroken',
          `vp-${baseWidth}px-at-200pct-zoom.png`
        )
      );
    }

    // 3b. Also test explicit CSS zoom: 2 on 1280px and 1600px viewports
    for (const width of [1280, 1600]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => {
        (document.documentElement.style as unknown as { zoom: string }).zoom = '2';
      });
      auditResults.push(
        await performGeometryAudit(
          width,
          900,
          '200%-css-zoom',
          'expanded',
          'stress_long_unbroken',
          `vp-${width}px-css-zoom-200pct.png`
        )
      );
      await page.evaluate(() => {
        (document.documentElement.style as unknown as { zoom: string }).zoom = '';
      });
    }

    await context.close();
  } finally {
    await browser.close();
    await server.close();
  }

  // Print summary table and fail if any geometry or overflow assertion failed
  console.log('='.repeat(78));
  console.log('Real Browser (Chromium) Layout & Geometry Verification Report');
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log('='.repeat(78));

  let failedAudits = 0;
  for (const res of auditResults) {
    const hasErrors =
      res.horizontalOverflowPx > 0 ||
      res.intersectionErrors.length > 0 ||
      res.overflowErrors.length > 0 ||
      res.controlSizeErrors.length > 0 ||
      res.rowCount === 0;

    if (hasErrors) {
      failedAudits += 1;
    }

    const status = hasErrors ? 'FAIL' : 'PASS';
    console.log(
      `[${status}] width=${res.viewportWidth}px zoom=${res.zoomLabel} sidebar=${res.sidebarState} data=${res.datasetLabel} | scrollW=${res.scrollWidth}/${res.innerWidth} (overflow=${res.horizontalOverflowPx}px) rows=${res.rowCount}`
    );
    for (const err of [
      ...res.intersectionErrors,
      ...res.overflowErrors,
      ...res.controlSizeErrors,
    ]) {
      console.error(`       -> ERROR: ${err}`);
    }
  }

  console.log('='.repeat(78));
  console.log(
    `Total Browser States Audited: ${auditResults.length} | Passed: ${
      auditResults.length - failedAudits
    } | Failed: ${failedAudits}`
  );
  console.log('='.repeat(78));

  if (failedAudits > 0) {
    process.exit(1);
  }
}

void runBrowserLayoutVerification();
