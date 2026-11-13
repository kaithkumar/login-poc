# Login POC: AI-assisted UI test automation

Scope of this repository (proof of concept):
- UI automation only. No API or mobile tests.
- One test case: TC-001, a registered user signs in with valid credentials.
- No Centre of Excellence yet. The conventions below are the temporary rules.

## Workflow

Start with the `/poc-login` prompt. It runs: plan, human approval, generate, run, heal, report.
The approval step is mandatory. Never generate a script from a plan that is not marked `Status: APPROVED`.

## Agents (in `.github/agents/`)

| Agent | Job | Writes |
| --- | --- | --- |
| `playwright-test-planner` | Explore the site and plan the login scenario | `specs/login.plan.md` |
| `playwright-test-generator` | Turn the approved plan into a script | `tests/generated/*.spec.js`, `pages/LoginPage.js` |
| `playwright-test-healer` | Repair failing locators and timing issues | `pages/LoginPage.js`, specs |

They use the Playwright test MCP server configured in `.vscode/mcp.json`.

## Conventions

- Page objects live in `pages/`. All locators for a page sit in one clearly marked block.
- Specs contain steps and assertions only, no raw locators.
- Locator preference: role, then label, then text. Avoid CSS or XPath by position.
- Credentials come only from `TEST_EMAIL` and `TEST_PASSWORD`. Never write them into any file, plan or log.
- Use a dedicated test account, never a personal one: anything typed during a live session is visible to the model.
- Screenshots, video and trace are kept on failure (see `playwright.config.js`).

## Stop and ask the human when

- A CAPTCHA, one-time code or bot check appears.
- A plan needs approval or the user asked for changes.
- The healer has used 3 attempts.
