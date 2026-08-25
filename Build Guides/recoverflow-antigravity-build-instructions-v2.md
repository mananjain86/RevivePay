# RecoverFlow — Build Instructions for Antigravity IDE (v2)

This is the corrected, hackathon-ready version of the spec. It incorporates a full technical review — see the "What Changed From v1" section at the end for a summary of every fix.

---

## 0. Project Summary

Build **RecoverFlow**, a multi-agent revenue recovery system for Razorpay Track 3 (AI Revenue Recovery). It processes a batch of failed payments and abandoned checkouts. For each case, AI agents diagnose the failure and assess recovery value; a separate, plain deterministic **Policy Guard** decides whether an action is allowed; only approved actions execute. A **Simulated Executor** handles the full batch (40-100 cases) without touching real Razorpay endpoints; a **Razorpay Executor** is used for only 2-3 hand-picked cases in the live demo, respecting Razorpay's test-mode Payment Link limits. Payment confirmation happens via a real Razorpay webhook, not by assuming a created link means paid. The system reports a real recovered-revenue number and includes a merchant-approval queue for higher-risk actions.

**Non-negotiable architecture rule:** LLM agents only ever *recommend*. The Policy Guard (deterministic code, zero LLM calls) is the only thing that approves an action. A created Payment Link is never treated as recovered revenue — only a confirmed webhook payment event is.

---

## 1. Tech Stack

- **Frontend:** React (Vite) + **Tailwind CSS**
- **Backend:** Node.js + Express
- **Database:** **MongoDB** (Mongoose) — kept over Supabase/Postgres since the case documents are naturally nested (audit log arrays, nested sub-objects), matching your existing MongoDB experience from CryptoGaze. MongoDB Atlas free tier works fine for this scale.
- **AI:** **Google Gemini API** (free tier) instead of Anthropic, since you have no budget for API costs. You've already integrated Gemini before, and its free tier has generous enough limits for a batch of 40-100 cases across 3 agent calls each. Use Gemini's JSON-mode/structured-output feature (`responseMimeType: "application/json"` with a `responseSchema`) for reliable parsing.
  - *Alternative if you hit Gemini free-tier limits:* Groq's free tier (fast inference, supports Llama/Mixtral models with JSON mode) is a solid backup — same integration pattern, different SDK.
- **Payments:** Razorpay Node SDK, test-mode, Payment Links API — split into two executor implementations (see Section 6.5).
- **Background jobs:** simple in-process job tracking (an in-memory `Map` of `jobId → { status, progress, results }` is enough for hackathon scope — no need for a real queue system like Bull/Redis).
- **Environment/config:** `.env` file — Gemini API key, Razorpay test key ID + secret, Razorpay webhook secret, MongoDB connection string.

---

## 2. Repository Structure

```
recoverflow/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── diagnosisAgent.js
│   │   │   ├── valueAgent.js
│   │   │   └── plannerAgent.js
│   │   ├── policy/
│   │   │   └── policyGuard.js          # deterministic, zero LLM calls
│   │   ├── execution/
│   │   │   ├── simulatedExecutor.js    # used for the full batch
│   │   │   └── razorpayExecutor.js     # used ONLY for 2-3 live demo cases
│   │   ├── orchestrator/
│   │   │   ├── caseOrchestrator.js
│   │   │   └── jobManager.js           # in-memory background job tracking
│   │   ├── webhooks/
│   │   │   └── razorpayWebhook.js      # signature verification + event dedup
│   │   ├── models/
│   │   │   ├── Case.js
│   │   │   └── ProcessedWebhookEvent.js # dedup table
│   │   ├── routes/
│   │   │   ├── cases.js
│   │   │   ├── approvals.js
│   │   │   ├── jobs.js
│   │   │   └── webhooks.js
│   │   ├── data/
│   │   │   ├── generateSyntheticData.js
│   │   │   └── demoFixtures.js         # deterministic outputs for DEMO_MODE
│   │   ├── config/
│   │   │   ├── geminiClient.js
│   │   │   └── razorpayClient.js
│   │   └── server.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CaseTable.jsx
│   │   │   ├── CaseDetailTrace.jsx
│   │   │   ├── ApprovalQueue.jsx
│   │   │   ├── SummaryCard.jsx
│   │   │   └── BatchRunProgress.jsx    # polls job status
│   │   ├── api/client.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
└── README.md
```

---

## 3. Environment Variables (`.env.example`)

```
GEMINI_API_KEY=your_key_here
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
MONGODB_URI=mongodb://localhost:27017/recoverflow
PORT=5000
DEMO_MODE=false
```

---

## 4. Amount Convention (fixed, non-negotiable)

**Rule: store and reason about amounts in whole rupees everywhere in the application (`amount` field = rupees, e.g. `2499` means ₹2,499). Only `razorpayExecutor.js` converts to paise, and only at the exact moment it calls the Razorpay API — multiply by 100 there and nowhere else.**

Never let `amount` mean paise anywhere else in the codebase — in the schema, in agent prompts, in the frontend, in synthetic data. This single rule prevents the ₹24.99-vs-₹2,499 bug entirely. Add a comment directly above the paise conversion line in `razorpayExecutor.js` stating this rule explicitly.

---

## 5. Data Model — `backend/src/models/Case.js`

```js
{
  case_type: { type: String, enum: ["failed_payment", "abandoned_checkout"], required: true },
  // NOTE: failed_subscription intentionally removed from v1 scope — see Section 11.

  amount: { type: Number, required: true }, // ALWAYS whole rupees, never paise — see Section 4
  currency: { type: String, default: "INR" },
  customer_id: { type: String, required: true },
  is_repeat_buyer: { type: Boolean, default: false },
  attempt_number: { type: Number, default: 1 },
  failure_reason_raw: { type: String },
  created_at: { type: Date, default: Date.now },

  // --- Consent / compliance fields (new) ---
  has_recovery_consent: { type: Boolean, default: true },
  contact_count: { type: Number, default: 0 },
  last_contacted_at: { type: Date, default: null },
  max_contact_count: { type: Number, default: 2 },

  status: {
    type: String,
    enum: [
      "new", "diagnosed", "valued", "planned", "policy_checked",
      "approved", "needs_merchant_approval",
      "link_created", "awaiting_payment",
      "recovered", "execution_failed",
      "blocked_stop_rule", "stopped_safely", "blocked_no_consent"
    ],
    default: "new"
  },

  diagnosis: { failure_class: String, confidence: Number, reasoning: String },

  value_assessment: {
    priority: { type: String, enum: ["high", "medium", "low"] },
    cart_value: Number,
    is_repeat_buyer: Boolean,
    attempt_number: Number
  },

  plan: {
    recommendation: {
      type: String,
      enum: ["CREATE_PAYMENT_LINK", "SEND_REMINDER", "OFFER_DISCOUNT", "ESCALATE_TO_HUMAN", "DO_NOT_CONTACT"]
    },
    reasoning: String,
    confidence: Number,
    discount_requested_pct: { type: Number, default: 0 }
  },

  policy_check: {
    decision: { type: String, enum: ["APPROVED", "REJECTED_FALLBACK", "NEEDS_MERCHANT_APPROVAL", "BLOCKED_STOP_RULE", "BLOCKED_NO_CONSENT"] },
    reason: String,
    fallback_action: String
  },

  merchant_approval: {
    required: { type: Boolean, default: false },
    approved_by_merchant: { type: Boolean, default: null },
    approved_at: Date
  },

  execution: {
    executor_type: { type: String, enum: ["simulated", "razorpay"], default: "simulated" },
    action_taken: String,
    result: { type: String, enum: ["success", "failure", "not_attempted"], default: "not_attempted" },
    razorpay_reference: String,
    payment_link_status: { type: String, enum: ["created", "paid", "expired", "cancelled", null], default: null },
    timestamp: Date
  },

  demo_case: { type: Boolean, default: false },

  audit_log: [
    { stage: String, timestamp: { type: Date, default: Date.now }, output: Object }
  ]
}
```

`backend/src/models/ProcessedWebhookEvent.js` (new — for dedup):
```js
{
  razorpay_event_id: { type: String, required: true, unique: true },
  processed_at: { type: Date, default: Date.now }
}
```

---

## 6. Agents & Policy — Exact Instructions

### 6.1 `diagnosisAgent.js` and `valueAgent.js`
Call **Gemini** — use `responseMimeType: "application/json"` with an explicit `responseSchema` matching the shapes below (Gemini's structured-output feature), rather than prompt-only JSON coaxing.

- `diagnoseCase(caseData)` → `{ failure_class, confidence, reasoning }`
- `assessValue(caseData)` → `{ priority, cart_value, is_repeat_buyer, attempt_number }`

Same parse-failure fallback behavior as before (default to safe/low values, log it, never throw unhandled).

### 6.2 `plannerAgent.js`
Allowed action set: `CREATE_PAYMENT_LINK`, `SEND_REMINDER`, `OFFER_DISCOUNT`, `ESCALATE_TO_HUMAN`, `DO_NOT_CONTACT`.

### 6.3 `policyGuard.js` — corrected rule set

```
CONSTANTS:
  MAX_ATTEMPTS = 3
  MIN_RECOVERABLE_AMOUNT = 100  (rupees)
  AUTO_APPROVE_DISCOUNT_MAX_PCT = 0
  APPROVAL_DISCOUNT_MAX_PCT = 5
  MIN_CONFIDENCE_AUTO_APPROVE = 0.6

function checkPolicy(caseData, plan):

  1. IF caseData.has_recovery_consent === false:
       RETURN { decision: "BLOCKED_NO_CONSENT", reason: "Customer has not consented to recovery contact" }

  2. IF caseData.attempt_number >= MAX_ATTEMPTS OR caseData.contact_count >= caseData.max_contact_count:
       RETURN { decision: "BLOCKED_STOP_RULE", reason: "Retry/contact cap reached" }

  3. IF caseData.amount < MIN_RECOVERABLE_AMOUNT:
       RETURN { decision: "BLOCKED_STOP_RULE", reason: "Amount below minimum recovery threshold" }

  4. IF plan.discount_requested_pct > APPROVAL_DISCOUNT_MAX_PCT:
       RETURN {
         decision: "REJECTED_FALLBACK",
         reason: "Discount exceeds maximum allowable ceiling (5%)",
         fallback_action: "CREATE_PAYMENT_LINK"
       }

  5. IF plan.discount_requested_pct > AUTO_APPROVE_DISCOUNT_MAX_PCT
     AND plan.discount_requested_pct <= APPROVAL_DISCOUNT_MAX_PCT:
       RETURN { decision: "NEEDS_MERCHANT_APPROVAL", reason: "Any discount (1-5%) requires merchant approval" }

  6. IF plan.confidence < MIN_CONFIDENCE_AUTO_APPROVE:
       RETURN { decision: "NEEDS_MERCHANT_APPROVAL", reason: "Planner confidence below auto-approve threshold" }

  7. OTHERWISE:
       RETURN { decision: "APPROVED", reason: "Within policy limits" }
```

**0% discount → can auto-approve. 1-5% → needs merchant approval. >5% → rejected outright, with an automatic no-discount fallback.** This is what actually implements `REJECTED_FALLBACK`, previously dead code.

### 6.4 Fallback handling
When `policy_check.decision === "REJECTED_FALLBACK"`, the orchestrator immediately re-runs from the execution step using `fallback_action` instead of the original `plan.recommendation` — e.g., silently downgrade "10% discount" to "plain payment link, no discount" and proceed as `APPROVED`. Log both the original rejected plan and the fallback action in `audit_log` — this rejection-then-fallback moment is one of your best demo beats.

### 6.5 Executors — split into simulated and real

**`simulatedExecutor.js`** (used for the full batch of 40-100 cases):
- Never calls the real Razorpay API.
- For `CREATE_PAYMENT_LINK` / `OFFER_DISCOUNT` (post-fallback or post-approval): generates a fake reference like `sim_plink_<random>`, sets `execution.payment_link_status = "created"`, `status = "link_created"`.
- Then simulates payment outcome probabilistically (e.g., 60-70% of "created" links resolve to `"paid"` after a simulated delay) — this produces an honest, varied aggregate recovery number across the batch without touching real Razorpay.
- For `SEND_REMINDER` / `ESCALATE_TO_HUMAN` / `DO_NOT_CONTACT`: logs the simulated outcome, no payment link involved.
- Increments `contact_count` and sets `last_contacted_at` whenever a contact-type action is taken.

**`razorpayExecutor.js`** (used for ONLY the 2-3 hand-picked live-demo cases):
- Makes a real call to Razorpay's test-mode Payment Links API.
- Converts rupees → paise **only here** (Section 4).
- Sets `execution.executor_type = "razorpay"`, `execution.razorpay_reference`, `payment_link_status = "created"`, `status = "awaiting_payment"` — not `"recovered"` yet.
- The case only becomes `status = "recovered"` when the webhook (Section 7) confirms an actual `payment_link.paid` event referencing this case's `razorpay_reference`.

The orchestrator picks the executor based on `caseData.demo_case` (boolean) — set manually on your 2-3 chosen cases in the synthetic data generator; everything else always uses `simulatedExecutor`.

### 6.6 `caseOrchestrator.js` — corrected gating logic

```
function processCase(caseId):
  load case
  run diagnoseCase → save, status="diagnosed", audit_log push
  run assessValue → save, status="valued", audit_log push
  run planRecovery → save, status="planned", audit_log push
  run checkPolicy → save, status="policy_checked", audit_log push

  SWITCH policy_check.decision:
    "APPROVED":
        status = "approved"
        executor = caseData.demo_case ? razorpayExecutor : simulatedExecutor
        run executor.execute(caseData, plan) → save execution result, audit_log push
        (status is set BY the executor itself — never force status="recovered" here
         just because the call succeeded)

    "REJECTED_FALLBACK":
        audit_log push (log the rejection + fallback_action)
        re-run using fallback_action as the new plan.recommendation → same executor branch as APPROVED

    "NEEDS_MERCHANT_APPROVAL":
        status = "needs_merchant_approval"
        merchant_approval.required = true
        STOP — wait for resolveApproval()

    "BLOCKED_STOP_RULE":
        status = "stopped_safely", audit_log push, STOP

    "BLOCKED_NO_CONSENT":
        status = "blocked_no_consent", audit_log push, STOP


function resolveApproval(caseId, approvedByMerchant):
  # FIXED: correctly re-enters the SAME execution branch as APPROVED,
  # instead of expecting a decision that no longer equals "APPROVED"
  IF approvedByMerchant:
      merchant_approval.approved_by_merchant = true, approved_at = now
      status = "approved"
      executor = caseData.demo_case ? razorpayExecutor : simulatedExecutor
      run executor.execute(...) → save, audit_log push
  ELSE:
      merchant_approval.approved_by_merchant = false
      status = "stopped_safely"
      audit_log push
```

---

## 7. Webhook Handling (new) — `backend/src/webhooks/razorpayWebhook.js`

Build `POST /api/webhooks/razorpay`:
1. Verify the Razorpay webhook signature using `RAZORPAY_WEBHOOK_SECRET` (Razorpay sends an `X-Razorpay-Signature` header — compute HMAC-SHA256 of the raw body and compare).
2. Reject with 400 if signature is invalid.
3. Check `ProcessedWebhookEvent` for the incoming event's `id` — if already present, return 200 immediately without reprocessing (dedup, prevents double-counting recovered revenue).
4. If new, insert into `ProcessedWebhookEvent`, then handle the event:
   - `payment_link.paid` → find the `Case` by `execution.razorpay_reference`, set `execution.payment_link_status = "paid"`, `status = "recovered"`, audit_log push.
   - `payment_link.expired` / `payment_link.cancelled` → set `payment_link_status` accordingly, `status = "execution_failed"`, audit_log push.
5. Always return 200 quickly (Razorpay retries on non-2xx).

This route is only relevant for the 2-3 real `razorpayExecutor` demo cases — simulated cases resolve their own outcome internally (Section 6.5) and never touch this endpoint.

---

## 8. Deterministic Demo Mode (new)

Build `backend/src/data/demoFixtures.js` containing hardcoded diagnosis/value/plan outputs for exactly the 3 demo cases, keyed by a fixed `customer_id` (e.g., `"demo-case-a"`, `"demo-case-b"`, `"demo-case-c"`).

In `caseOrchestrator.js`, at the top of each agent-calling step:
```
IF process.env.DEMO_MODE === "true" AND demoFixtures[caseData.customer_id] exists:
    use the fixture value for that stage instead of calling the LLM
ELSE:
    call the real agent as normal
```

This guarantees your three scripted demo moments (auto-recovery, safe-stop, human-approval-needed) fire exactly as planned every time you demo live, regardless of LLM variability — while the rest of the batch still runs through real Gemini calls to produce a genuine, non-rigged aggregate number. Toggle `DEMO_MODE=true` only right before your live walkthrough of those 3 cases; leave it `false` for the full-batch run so your headline recovery-rate number stays honest.

*(Alternative: add a deterministic pre-planning eligibility rule instead of fixtures, e.g. "abandoned checkouts with `amount > 7000` and `attempt_number === 1` are always routed by code to propose a 5% discount before the Planner even runs." Fixtures are simpler to implement correctly under time pressure.)*

---

## 9. Background Job for Batch Runs (new)

`backend/src/orchestrator/jobManager.js`:
- `startBatchJob()` → creates a `jobId`, stores `{ status: "running", total, completed: 0 }` in an in-memory `Map`, kicks off processing without awaiting it, returns `jobId` immediately.
- Processes cases in chunks of 5-10 concurrently to respect Gemini/Razorpay rate limits, updating `completed` count as each finishes.
- `getJobStatus(jobId)` → returns current `{ status, completed, total }`.

Routes:
- `POST /api/cases/run-batch` → calls `startBatchJob()`, returns `{ jobId }` immediately.
- `GET /api/jobs/:jobId` → returns current status for polling.

**`BatchRunProgress.jsx`**: after clicking "Run Batch," poll `GET /api/jobs/:jobId` every 1-2 seconds, show a progress bar, refresh the case table once done.

---

## 10. Frontend — Tailwind Setup Notes

- Initialize with `npm create vite@latest frontend -- --template react`, then add Tailwind per its Vite integration guide.
- Component responsibilities unchanged (`CaseTable`, `CaseDetailTrace`, `ApprovalQueue`, `SummaryCard`) — style with Tailwind utility classes. Use status-based color coding (green for `recovered`, amber for `needs_merchant_approval`, gray for `stopped_safely`, red for `execution_failed`).
- Add `BatchRunProgress.jsx` as described in Section 9.

---

## 11. Scope Changes for v1 (confirmed)

- **Dropped:** `failed_subscription` and `RETRY_SUBSCRIPTION` entirely from v1. Razorpay already auto-retries some failed subscription charges, and the available recovery behavior depends on subscription/invoice state in ways that need real study before building. Revisit only after the core flow is fully working and demoed.
- **Kept:** `failed_payment` and `abandoned_checkout` as the two case types for v1.

---

## 12. Synthetic Data Generator — corrected

Generate 40-100 cases (well under Razorpay's test-mode link cap, since only 2-3 ever use `razorpayExecutor`). Include:
- Realistic variation across `case_type`, `amount` (always rupees), `attempt_number`, `is_repeat_buyer`, `has_recovery_consent` (a few `false`, to demonstrate the consent-block rule), `contact_count`/`max_contact_count` (a few already at cap, to demonstrate the stop rule independent of `attempt_number`).
- Exactly 3 cases flagged `demo_case: true` with fixed `customer_id`s matching `demoFixtures.js` keys, sized for the 3 demo narratives (clean recovery, safe stop, discount-needs-approval).

---

## 13. Build Order

1. Scaffold `backend/` and `frontend/` (with Tailwind) per Section 2.
2. Set up `.env`, MongoDB connection, `Case` + `ProcessedWebhookEvent` schemas.
3. Build synthetic data generator with the 3 flagged demo cases and consent/contact-cap variation.
4. Build `diagnosisAgent.js` + `valueAgent.js` against Gemini, test standalone.
5. Build `plannerAgent.js`, test standalone.
6. Build `policyGuard.js` — manually test every rule branch, including `REJECTED_FALLBACK` and `BLOCKED_NO_CONSENT`, before wiring into the pipeline.
7. Build `simulatedExecutor.js` first (no external dependency, fast to test).
8. Build `razorpayExecutor.js` — get one real test-mode Payment Link created manually before integrating.
9. Build `razorpayWebhook.js` — test signature verification and dedup with a manually-crafted test payload before relying on real webhook delivery.
10. Build `caseOrchestrator.js` with corrected gating logic (Section 6.6) — run against the 3 demo cases first, confirm each lands in the expected status.
11. Build `jobManager.js` + batch API routes.
12. Build demo fixtures + `DEMO_MODE` toggle.
13. Build frontend components, including `BatchRunProgress`.
14. Run the full batch with `DEMO_MODE=false`, verify a real aggregate recovery number. Switch `DEMO_MODE=true` and confirm the 3 scripted cases behave exactly as expected for the live walkthrough.
15. Polish, README, final check that `.env.example` has no real secrets committed.

---

## 14. What to Read and Study

| Topic | What to read | Why |
|---|---|---|
| Razorpay Payment Links API | Official docs, Payment Links section, including test-mode link-count limits | Core execution mechanism |
| Razorpay amount/currency conventions | Same Payment Links create-standard doc — subunit (paise) requirement | Prevents the ₹24.99 bug — read before writing `razorpayExecutor.js` |
| Razorpay Webhooks | Official docs on webhook setup, signature verification, event types (`payment_link.paid`, etc.) | New territory — budget real time here |
| Gemini API structured output | Google AI's docs on `responseMimeType`/`responseSchema` (JSON mode) | Needed for reliable agent parsing |
| Mongoose nested schemas + arrays | Mongoose docs on nested objects/array-of-object fields | For `audit_log` and nested sub-objects |
| Express webhook signature verification (HMAC) | Any concise Node crypto `hmac` guide, or Razorpay's own sample code | Needed for Section 7 |
| Tailwind + Vite setup | Tailwind's official Vite integration guide | Quick one-time setup reference |
| Node async concurrency in chunks | "Promise.all in batches" pattern | For `jobManager.js` |

The genuinely new study items compared to before: **Razorpay webhooks + signature verification**, and **Gemini's structured-output mode**. Everything else is unchanged or a quick reference check.

---

## What Changed From v1 (summary)

1. Tailwind CSS added to frontend.
2. Kept MongoDB (reasoned choice, not default).
3. Switched Anthropic → Gemini (free tier) for all agent calls.
4. Fixed: Payment Link creation no longer treated as "recovered" — new `link_created`/`awaiting_payment` statuses, recovery only confirmed via webhook.
5. Fixed: `resolveApproval` now correctly re-enters the execution branch instead of expecting a stale `"APPROVED"` decision.
6. Fixed: split into `simulatedExecutor` (full batch) and `razorpayExecutor` (2-3 demo cases only), respecting Razorpay's test-mode link cap.
7. Fixed: single explicit rupees-everywhere convention, paise conversion isolated to one line in one file.
8. Added: full webhook endpoint with signature verification and event dedup.
9. Added: consent and contact-cap fields, enforced by the Policy Guard.
10. Removed: `failed_subscription`/`RETRY_SUBSCRIPTION` from v1 scope entirely.
11. Added: `DEMO_MODE` with deterministic fixtures so the 3 scripted demo cases are actually guaranteed.
12. Fixed: `REJECTED_FALLBACK` now has a real implementation (discount downgraded to plain link).
13. Fixed: discount policy tiers no longer contradictory (0% auto-approvable, 1-5% needs approval, >5% blocked with fallback).
14. Fixed: batch run is now a background job with polling, not a long-blocking HTTP request.
