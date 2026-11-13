# Login POC (UI only)

One test case, TC-001: a registered user signs in with valid credentials.

## Run it

```bash
npm install
npx playwright install chromium

# 1. Discovery: opens the site, goes to sign-in, saves a screenshot and an
#    accessibility snapshot in ./inspect-output
BASE_URL=https://amazon.ai npm run inspect

# 2. If the snapshot shows different labels or button names, edit the single
#    locator block in pages/LoginPage.js

# 3. Run the test with a TEST account (never a personal one)
TEST_EMAIL='you@example.com' TEST_PASSWORD='...' npm test
npm run report   # HTML report with screenshots, video and trace on failure
```

On Windows PowerShell use `$env:TEST_EMAIL='...'` before `npm test`.

## Run it with the local AI agents (Ollama qwen3:8b + Playwright MCP)

No cloud model is used. The model runs in your local Ollama and drives a real browser
through Playwright MCP tools.

```bash
ollama serve                  # if it is not already running
ollama pull qwen3:8b          # already done on your machine

export TEST_EMAIL='test-account@example.com'    # dedicated TEST account
export TEST_PASSWORD='...'
npm run agent -- https://amazon.ai
```

The browser is Google Chrome by default (Playwright MCP's default). No Chrome? Set
`MCP_BROWSER=msedge`, or `PW_EXECUTABLE_PATH=/path/to/a/chromium`.

What happens:

1. **Research and plan (Planner agent, `agents/planner.md`).** `run.js` starts the Playwright MCP
   server and gives qwen3:8b a small set of browser tools: navigate, snapshot, click, type, fill form,
   press key, wait, hover. The model opens your URL, finds Sign in, looks at the form, tries the
   empty and badly formatted email cases with fake data, and reaches the password step. Then it writes
   login test cases (valid login, empty email, invalid email, forgot password, and so on) to
   `specs/login.plan.md` as `Status: DRAFT`. Each case is marked Observed or Suggested.
2. **Approval.** The plan is shown in the terminal. Type `y` to approve, `r` after editing the file
   yourself, or `n` to stop. No answer means no approval, and nothing is generated.
3. **Generate (Generator agent, `agents/generator.md`).** For TC-001 (valid login), the model returns
   the locators as JSON, using the page states it saw during research. They are checked strictly, then written
   into fixed templates: `pages/generated/LoginPage.js` and `tests/generated/login.spec.js`.
   The other test cases stay as proposals in the plan.
4. **Run and heal.** The test runs. If it fails, the Inspector agent (`agents/inspector.md`) browses the
   site again through MCP, and the Healer agent (`agents/healer.md`) corrects the locators. Up to 3 attempts.
   CAPTCHA or verification screens stop the run instead of being "healed".

Safety rules enforced in code (`agent-runner/browser.js`), not left to the model:

- Only 10 browser tools are offered (including `browser_find`, which locates elements by a word in their name and is not case-sensitive). Code-running tools (`browser_evaluate`, `browser_run_code_unsafe`),
  file upload, network and console readers are not.
- `browser_navigate` is limited to the target site and its subdomains.
- The model never sees your credentials. It writes `{{TEST_EMAIL}}` and the runner fills in the real
  address when typing. Typing a password (the placeholder or the real value) is blocked.
- Page content is treated as data; the prompts tell the model to ignore instructions found on pages.

Things the runner does to help a small model cope with real sites:

- **Compacts big pages.** A real home page can produce 50,000+ characters of snapshot. The runner keeps every
  line about sign-in, account, email, password and errors first, then other clickable elements, and drops the rest.
- **Checks element refs.** Clicks and typing need a ref copied from the page state (like `e12`). If the model
  invents one, or uses XPath, CSS or text, the call is refused with an explanation and a pointer to `browser_find`.
- **Ignores snapshot options** such as `depth:1`, which hide almost the whole page.
- **Retries once** with a hint if the research never reached the sign-in form, and **stops** (no plan written for
  approval) if it still did not, so you are never asked to approve an invented plan.
- **Saves `specs/research-log.md`** with every tool call and the start of every result. If a run misbehaves,
  read that file first, or send it to whoever is helping you.

Settings (environment variables): `OLLAMA_MODEL` (default `qwen3:8b`), `OLLAMA_HOST` (default
`http://localhost:11434`), `OLLAMA_NUM_CTX` (default 16384), `MAX_STEPS` (research tool calls, default 20),
`HEADLESS=1` to hide the browser, `MCP_BROWSER`, `PW_EXECUTABLE_PATH`, `MCP_NO_SANDBOX=1` (Linux containers only).

Why the model fills templates instead of writing free code: an 8B model is far more reliable
answering a small, schema-checked JSON than writing a whole test file. The templates are what the
Centre of Excellence will replace later. If the model gets lost while browsing, lower `MAX_STEPS` or
raise `OLLAMA_NUM_CTX`.

### Using GitHub Copilot instead

`.github/agents/`, `.github/prompts/poc-login.prompt.md` and `.vscode/mcp.json` hold the same three
agents in Copilot's format. They do not pin a model, so they use whichever model you pick in the chat
model picker. A small local model may struggle to drive the browser tools there; the runner above is the more reliable path.

## Layout

| File | Purpose |
| --- | --- |
| `scripts/inspect-login.js` | The discovery step a human or an AI agent runs first |
| `pages/LoginPage.js` | Page object; all locators in one block |
| `tests/login.spec.js` | TC-001 as readable steps |
| `playwright.config.js` | Base URL, screenshot, video and trace settings |
| `agents/` | Planner, inspector, generator and healer prompts used by the Ollama runner |
| `agent-runner/` | The local pipeline: `run.js` (flow), `agent.js` (tool loop), `browser.js` (Playwright MCP + safety rules), `ollama.js`, `locators.js` |
| `.github/`, `.vscode/mcp.json` | Optional: the same agents in GitHub Copilot format |
| `specs/` | Test plans (draft, then approved) |
| `tests/seed.spec.js` | Starting page for the agents |

## Known limits

- Locators are unverified until you run the inspect step on the real site.
- Large retail sites often show a CAPTCHA, a one-time code or a "suspicious
  activity" page to automated browsers. If that happens, use a dedicated test
  account on a test or staging environment, or save a logged-in session with
  Playwright's `storageState` instead of automating the login each run.
- Check the site's terms before automating against production.
