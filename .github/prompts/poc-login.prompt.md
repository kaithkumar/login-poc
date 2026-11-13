---
description: Explore a site, plan the login test, wait for approval, then generate the script
agent: agent
---

Run the login POC for this site: ${input:siteUrl:Site URL, for example https://amazon.ai}

Follow these steps in order and do not skip the approval step.

1. **Set the target.** Use the URL above as `BASE_URL` for this run.
2. **Plan.** Hand off to the `playwright-test-planner` agent. It explores the site, finds the sign-in flow and saves `specs/login.plan.md` with the first line `Status: DRAFT - awaiting human approval`.
3. **Approval gate.** Show me the plan in plain language: the steps, the expected result, and any blockers (CAPTCHA, one-time code). Then STOP and ask me to approve, edit or reject it. Do not continue until I answer.
   - Approve: change the first line of the plan to `Status: APPROVED`.
   - Edit: apply my changes, show the plan again, and ask again.
   - Reject: stop.
4. **Generate.** Hand off to the `playwright-test-generator` agent to write `tests/generated/login-valid-credentials.spec.js` and update the locator block in `pages/LoginPage.js`.
5. **Run.** Run `npx playwright test tests/generated` with `TEST_EMAIL` and `TEST_PASSWORD` from my environment. If they are not set, tell me and stop after generating the script.
6. **Heal if needed.** If the test fails on a locator or timing problem, hand off to the `playwright-test-healer` agent (3 attempts at most). Do not heal around a CAPTCHA, wrong credentials or a locked account; report them instead.
7. **Report.** In a few lines: which files were created, whether the test passed, and anything I need to do next.
