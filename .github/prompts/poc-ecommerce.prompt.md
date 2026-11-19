---
description: >
  Research a retail site, plan a category-> subcategory->cheapest item -> cart purchase flow, wait for approval, generate the playwright test, run it, heal if needed, and report.
agent: agent
---

Run the e-cemmerce POC for this site and task:

- **Site URL:** ${input:siteUrl:Full Site URL, for example https://amazon.ai}
- **Task:** ${input:task:Shopping task, e.g. "MEN > t-shirt, lowest price"}

follow these steps **in order** and Do not skip the approval step.

---

## Step 1 -> Plan

Hand off to the 'ecommerce-planner' agent.

It will:
- Navigate the site using the category and subcategory from the task..
- Sort the product listing by lowest price and note the first product's name price
- Add the product to the cart and inspect the cart page.
- Save the plan in `specs/ecommerce.plan.md` with the first line `Status: DRAFT - awaiting human approval`.

---

## Step 2 -> Approval gate STOP HERE

Show me the plan in plain language: 
- The excat navigation path (category -> subcategory).
- The sort control and option label used.
- The first product name and price observed.
- The cart confirmation text and "proceed to checkout" button label.
- Any **blockers** (CAPTCHA, age-gate, out-of-stock).

**STOP and ask me to approve, edit or reject it.** Do not continue until I answer.**


- **Approve** -> change the first line to `Status: APPROVED` and continue
- **Edit** -> apply my changes, show the plan again, ans ask again.
- **Reject** -> stop.

---

## Step 3 -> Generate

Hand off to the 'ecommerce-generator' agent.

It will:
- Drive the site step-by-step to verify the locator.
- Write `pages/generated/EcommercePage.js` (page object, all locators in one block).
- Write `tests/generated/ecommerce.spec.js` (steps and assetions only, no raw locators).  

---

## Step 4 -> Run

Run:
```bash
npx playwright test tests/generated/ecommerce.spec.js --reporter=line
```
with `BASE_URL` set to the site URL.
If `BASE_URL` is not in the enviroment, set it and try again. Report the result.

---

## Step 5 -> Heal (if the test fails)

If the test fails on a **locator or action problem**, hand off to the 'ecommerce-healer' agent.

Allow at most **3 repair attempts**.

Do **not** attempt to heal if the failure is:
- A CAPTCHA or bot-check
- A mandatory login wall
- An out-of-stock product (no "Add to cart" available)
- Wrong or missing credentials

Report these as enviroment or data problems instead.

---

## Step 6 -> Report

Summarize in a few lines:
- Files created or updated.
- Whether TC-001 passed or failed
- The product name and price that was added to the cart (if passed).
- Any remaining blockers or follow-up actions needed.
