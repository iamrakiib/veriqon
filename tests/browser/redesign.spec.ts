import { test, expect, type Page } from "@playwright/test";
const source = {
  id: "policy",
  text: "Employees may work remotely one day per week.",
  source: "policy.md",
  chunkCount: 2,
  version: "approved-v2",
  hasOriginal: true,
};
const citation = {
  index: 1,
  documentId: "policy",
  source: "policy.md",
  version: "approved-v2",
  chunkIndex: 0,
  excerpt: source.text,
};
const result = {
  draft: "One day per week. [1]",
  status: "repaired",
  verificationStatus: "REPAIRED_VERIFIED",
  factCheck: {
    verdict: "Supported by the policy",
    evidence: "The policy specifies one day.",
    passed: true,
    claims: [],
    atomicClaims: [
      {
        id: "s1c1",
        text: "One day per week.",
        verdict: "SUPPORTED",
        supporting: [{ index: 1, quote: source.text }],
        contradicting: [],
      },
    ],
  },
  citations: [citation],
  attempts: 2,
  durationMs: 2500,
  correction: {
    original: "Three days per week.",
    revised: "One day per week. [1]",
    reason: "Corrected against policy.",
  },
  repairHistory: [
    {
      original: "Three days per week.",
      revised: "One day per week. [1]",
      accepted: true,
      reason: "The approved policy permits one day.",
      edits: [
        {
          claimId: "s1c1",
          original: "Three days",
          replacement: "One day",
          evidence: [{ index: 1, quote: source.text }],
        },
      ],
      after: { passed: true, verdict: "Correction supported" },
    },
  ],
  modelUsage: [
    {
      stage: "Verification",
      model: "fixture",
      durationMs: 2500,
      success: true,
      promptTokens: 100,
      completionTokens: 20,
    },
  ],
};
const message = {
  id: "m1",
  question: "How many days?",
  createdAt: new Date().toISOString(),
  result,
};
async function navigate(page: Page, title: string) {
  if ((page.viewportSize()?.width || 0) <= 850)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
  await page.getByRole("button", { name: title, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/status", (r) =>
    r.fulfill({ json: { needsSetup: false, registrationEnabled: true } }),
  );
  await page.route("**/api/auth/me", (r) =>
    r.fulfill({
      json: {
        user: {
          id: "fixture",
          name: "Alex Morgan",
          email: "alex@example.test",
          role: "owner",
        },
      },
    }),
  );
  await page.route("**/api/rag/health", (r) =>
    r.fulfill({
      json: { status: "ok", providerConfigured: true, storage: "sqlite" },
    }),
  );
  await page.route("**/api/rag/docs", (r) => r.fulfill({ json: [source] }));
  await page.route("**/api/rag/conversations", (r) =>
    r.fulfill({
      json: [{ id: "c1", title: "Remote work research", messages: [message] }],
    }),
  );
  await page.route("**/api/rag/conflicts", (r) =>
    r.fulfill({
      json: {
        coverage: "saved_answer_assessments",
        reviewedAnswers: 1,
        truncated: false,
        records: [],
      },
    }),
  );
});
test("navigation, theme and route screenshots remain accessible at desktop and mobile sizes", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Add documents" }),
  ).toBeEnabled();
  if (info.project.name === "desktop") {
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.locator(".sidebar")).toHaveCSS("width", "72px");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
  }
  for (const theme of ["dark", "light"]) {
    if (theme === "light")
      await page.getByRole("button", { name: "Switch to light mode" }).click();
    for (const title of [
      "Knowledge base",
      "Chat workspace",
      "Chat history",
      "Corrections",
      "Analytics",
      "Conflict center",
    ]) {
      await navigate(page, title);
      await expect(page.getByRole("main")).toBeVisible();
      await page.screenshot({
        path: `data/ui-review-${info.project.name}-${theme}-${title.replaceAll(" ", "-")}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  expect(errors).toEqual([]);
});
test("claim diff, exact evidence relationship and version are connected to recorded assessments", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await navigate(page, "Corrections");
  await expect(page.locator(".change-grid del")).toHaveText("Three days");
  await expect(page.locator(".change-grid ins")).toHaveText("One day");
  await expect(
    page.getByText("Correction supported", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open affected answer" }).click();
  await expect(
    page.getByText("Repaired & verified", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open passage 1 from policy.md" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("approved-v2");
  await expect(page.getByRole("dialog")).toContainText(
    "Assessed as supporting",
  );
  await expect(page.getByRole("dialog")).toContainText(source.text);
  await expect(page.getByRole("dialog")).toHaveClass(/source-drawer/);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open passage 1 from policy.md" }),
  ).toBeFocused();
});
test("analytics uses recorded tokens and honest partial coverage; legacy repairs are not certified", async ({
  page,
}) => {
  const legacy = {
    ...message,
    id: "m2",
    question: "Earlier assessment",
    result: {
      ...result,
      verificationStatus: undefined,
      repairHistory: undefined,
      modelUsage: undefined,
    },
  };
  await page.route("**/api/rag/conversations", (r) =>
    r.fulfill({
      json: [
        {
          id: "c1",
          title: "Research",
          messages: [
            message,
            legacy,
            {
              id: "m3",
              question: "Failed request",
              createdAt: new Date().toISOString(),
              error: "Provider unavailable",
            },
          ],
        },
      ],
    }),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await navigate(page, "Analytics");
  const tokens = page.locator(".metric").filter({ hasText: "Reported tokens" });
  await expect(tokens.locator("strong")).toHaveText("120");
  await expect(tokens).toContainText("Partial total");
  await expect(
    page
      .locator(".metric")
      .filter({ hasText: "Verified answers" })
      .locator("strong"),
  ).toHaveText("1");
  await navigate(page, "Corrections");
  await expect(
    page.getByText("Earlier repair", { exact: false }).first(),
  ).toBeVisible();
  await page.getByLabel("Filter corrections").selectOption("verified");
  await expect(page.locator(".correction-record")).toHaveCount(1);
  await page.getByLabel("Filter corrections").selectOption("withheld");
  await expect(page.locator(".correction-record")).toHaveCount(1);
  await expect(page.locator(".correction-record")).toContainText(
    "Earlier assessment",
  );
});

test("unsent text survives navigation and the composer grows within the viewport", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await navigate(page, "Chat workspace");
  const input = page.getByLabel("Ask your knowledge base");
  const initial = (await input.boundingBox())!.height;
  await input.fill("First line\nSecond line\nThird line\nFourth line");
  expect((await input.boundingBox())!.height).toBeGreaterThan(initial);
  await page.getByRole("button", { name: "Show workspace" }).click();
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(input).toHaveValue(
    "First line\nSecond line\nThird line\nFourth line",
  );
  const send = (await page
    .getByRole("button", { name: "Send question" })
    .boundingBox())!;
  expect(send.y + send.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('tablet navigation keeps every research view within the viewport', async ({page}, info) => {
  test.skip(info.project.name !== 'desktop', 'One tablet pass uses the desktop browser context.');
  await page.setViewportSize({width:800,height:1024});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  for(const title of ['Knowledge base','Chat workspace','Chat history','Corrections','Analytics','Conflict center']) {
    await navigate(page,title);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('main')).toBeVisible();
  }
  await page.screenshot({path:'data/ui-review-tablet.png'});
});

test('technical verification failures explain the issue and let the user retry the original question', async ({ page }) => {
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'c1', title: 'Research', messages: [{
    ...message,
    result: { ...result, status: 'abstained', verificationStatus: 'VERIFICATION_FAILED', correction: null, repairHistory: [],
      draft: 'The answer-checking step could not complete reliably.',
      factCheck: { passed: false, verdict: 'Verification failed', evidence: 'Claim extraction returned an invalid structure.', claims: [], atomicClaims: [], failure: { stage: 'decomposition', code: 'invalid_response', retryable: true } }
    }
  }] }] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Chat workspace');
  await expect(page.getByText('Answer checking did not complete.', { exact: false })).toBeVisible();
  await expect(page.getByText('Repaired & verified', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry this question' }).click();
  await expect(page.getByLabel('Ask your knowledge base')).toHaveValue(message.question);
  await expect(page.getByLabel('Ask your knowledge base')).toBeFocused();
});

test('semantic cache reuse is labelled with its original question and keeps source links', async ({ page }) => {
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'c1', title: 'Research', messages: [{
    ...message, question: 'What is the remote day allowance?', result: { ...result, cached: true, modelUsage: [],
      cache: { kind: 'semantic', matchedQuestion: 'How many days?', ageMs: 1000, lookupMs: 500, policyVersion: 'semantic-v1' }
    }
  }] }] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Chat workspace');
  await expect(page.getByText('Reused for an equivalent question', { exact: false })).toBeVisible();
  await expect(page.getByText('Originally checked for: How many days?')).toBeVisible();
  await page.getByRole('button', { name: 'Open passage 1 from policy.md' }).click();
  await expect(page.getByRole('dialog')).toContainText('approved-v2');
});

test('record-based answers and contextual answers disclose their different evidence paths', async ({ page }) => {
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'c1', title: 'Research', messages: [
    { ...message, id: 'inventory', question: 'How many documents are in my workspace?', result: { ...result, draft: 'Your workspace contains 1 document: policy.md.', answerOrigin: 'workspace_metadata', status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED', citations: [], attempts: 0, modelUsage: [], correction: null, repairHistory: [] } },
    { ...message, id: 'context', question: 'How many days does it permit?', result: { ...result, contextUsed: true, retrievalMode: 'lexical_fallback' } }
  ] }] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Chat workspace');
  await expect(page.getByText('Checked records', { exact: true })).toBeVisible();
  await expect(page.getByText('Read from your saved records / No AI calls')).toBeVisible();
  await expect(page.getByText('Used recent questions to resolve source references. Previous answers are not source evidence.')).toBeVisible();
  await expect(page.getByText('Keyword search was used because semantic search was unavailable.', { exact: false })).toBeVisible();
});

test('analytics and corrections distinguish generation retries, cached repairs and checked records', async ({ page }) => {
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'c1', title: 'Research', messages: [
    message,
    { ...message, id: 'cached', question: 'Cached repair', result: { ...result, cached: true, attempts: 0, modelUsage: [] } },
    { ...message, id: 'retried-generation', question: 'A second draft without correction', result: { ...result, status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED', correction: null, repairHistory: [] } },
    { ...message, id: 'metadata', question: 'Document inventory', result: { ...result, answerOrigin: 'workspace_metadata', status: 'supported', verificationStatus: 'VERIFIED_UNCHANGED', attempts: 0, modelUsage: [], correction: null, repairHistory: [] } }
  ] }] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Corrections');
  await expect(page.locator('.correction-record')).toHaveCount(1);
  await navigate(page, 'Analytics');
  await expect(page.locator('.metric').filter({ hasText: 'Verified repairs' }).locator('strong')).toHaveText('1');
  await expect(page.locator('.metric').filter({ hasText: 'Verified answers' }).locator('strong')).toHaveText('3');
  const tokens = page.locator('.metric').filter({ hasText: 'Reported tokens' });
  await expect(tokens.locator('strong')).toHaveText('240');
  await expect(tokens).not.toContainText('Partial total');
  await expect(page.getByText('Up to 100 recent conversations')).toHaveCount(0);
});

test('stored source names, questions and model text render as text rather than executable HTML', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const attack = '<img src=x onerror="window.__veriqonInjected=1">';
  const hostileCitation = { ...citation, source: attack + '.txt', excerpt: attack };
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'c1', title: attack, messages: [{
    ...message, question: attack, result: { ...result, draft: attack + ' [1]', citations: [hostileCitation], correction: null, repairHistory: [] },
  }] }] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Chat workspace');
  await expect(page.locator('.answer-text')).toContainText(attack);
  await expect(page.locator('.user-message')).toHaveText(attack);
  await expect(page.locator('.chat-panel img')).toHaveCount(0);
  await page.getByRole('button', { name: `Open passage 1 from ${hostileCitation.source}`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(attack);
  await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => '__veriqonInjected' in window)).toBe(false);
  expect(errors).toEqual([]);
});

test('long unbroken answers keep the composer usable on small and short displays', async ({ page }, info) => {
  await page.setViewportSize(info.project.name === 'mobile' ? { width: 320, height: 568 } : { width: 1024, height: 520 });
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'c1', title: 'Long content', messages: [{
    ...message, result: { ...result, draft: 'x'.repeat(2500) + ' [1]' },
  }] }] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Chat workspace');
  const composer = page.getByLabel('Ask your knowledge base');
  await composer.fill('A follow-up question');
  await expect(page.getByRole('button', { name: 'Send question' })).toBeEnabled();
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('a conflict opens its exact saved answer beyond loaded history with inspectable evidence', async ({ page }) => {
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [] }));
  await page.route('**/api/rag/conflicts', route => route.fulfill({ json: { reviewedAnswers: 30, truncated: false, records: [{
    id: 'older-conflict', messageId: 'older-answer', question: 'Older allowance?', claim: 'Allowances disagree', detectedAt: new Date().toISOString(),
    scope: { time: '2026', place: 'Engineering' }, reason: 'No precedence established.',
    supporting: [{ ...citation, quote: citation.excerpt }], contradicting: [{ ...citation, index: 2, documentId: 'memo', source: 'memo.txt', quote: 'Three days.' }]
  }] } }));
  await page.route('**/api/rag/messages/older-answer', route => route.fulfill({ json: { conversationId: 'old-chat', title: 'Older policy question', message: { ...message, id: 'older-answer', question: 'Older allowance?' } } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await navigate(page, 'Conflict center');
  await page.getByRole('button', { name: /Allowances disagree/ }).click();
  await page.getByRole('button', { name: /Open affected answer/ }).click();
  const saved = page.getByRole('dialog', { name: 'Saved answer', exact: true });
  await expect(saved).toContainText('Older allowance?');
  await expect(saved).toContainText('One day per week.');
  await saved.getByRole('button', { name: '[1] policy.md', exact: true }).first().click();
  const source = page.getByRole('dialog', { name: 'policy.md', exact: true });
  await expect(source).toContainText(citation.excerpt);
  await source.getByRole('button', { name: 'Close dialog' }).click();
  await expect(saved).toBeVisible();
});

test('analytics distinguishes missing evidence from technical failures and conflicts without double counting', async ({ page }) => {
  const outcomes = ['INSUFFICIENT_EVIDENCE', 'PARTIALLY_VERIFIED', 'UNRESOLVED_CONFLICT', 'VERIFICATION_FAILED'];
  await page.route('**/api/rag/conversations', route => route.fulfill({ json: [{ id: 'c1', title: 'Outcomes', messages: [
    ...outcomes.map((verificationStatus, i) => ({ ...message, id: `outcome-${i}`, result: { ...result, status: 'abstained', verificationStatus, factCheck: { ...result.factCheck, passed: false }, correction: null, repairHistory: [] } })),
    { id: 'transport-failure', question: 'Unavailable request', createdAt: message.createdAt, error: 'Connection failed' }
  ] }] }));
  await page.goto('/', { waitUntil: 'domcontentloaded' }); await navigate(page, 'Analytics');
  const count = (label: string) => page.getByText(label, { exact: true }).locator('..').locator('dd');
  await expect(count('Abstained / partly verified')).toHaveText('2');
  await expect(count('Answers with unresolved conflicts')).toHaveText('1');
  await expect(count('Generation / verification failures')).toHaveText('1');
  await expect(count('Request failures')).toHaveText('1');
});
