# RecoverFlow — Build Instructions for Antigravity IDE (v3)

Corrected, hackathon-ready spec. See "What Changed From v2" at the end for this round's fixes; v2's own changelog is preserved further down for full history.

---

## 0. Project Summary

Build **RecoverFlow**, a multi-agent revenue recovery system for Razorpay Track 3. It processes a batch of failed payments and abandoned checkouts. AI agents diagnose the failure and assess recovery value; a deterministic **Policy Guard** decides whether an action is allowed; only approved actions execute. A **Simulated Executor** handles the full batch with deterministic, seeded outcomes; a **Razorpay Executor** handles only 2-3 hand-picked live-demo cases via real test-mode Payment Links, confirmed only by webhook. The system reports two separate, clearly-labeled metrics — a simulated batch figure and a verified real-money figure — never conflated into one number.

**Non-negotiable rules:**
- LLM agents only ever *recommend*. The Policy Guard (zero LLM calls) is the only thing that approves an action.
- A created Payment Link is never "recovered" — only a confirmed webhook payment event is.
- A fallback action must clear the Policy Guard again on its own merits — it is never auto-approved just because it dodged the original rejection reason.
- Simulated and real recovered-revenue figures are always reported separately, never combined into a single headline number.

---

## 1. Tech Stack

- **Frontend:** React (Vite) + Tailwind CSS
- **Backend:** Node.js + Express
- **Database:** MongoDB (Mongoose)
- **AI:** Google Gemini API (free tier), structured JSON output via `responseSchema`. Backup: Groq free tier if rate-limited.
- **Payments:** Razorpay Node SDK, test-mode, Payment Links API — split executors (Section 6.5).
- **Background jobs:** in-memory job tracking (`Map` of `jobId → status`).
- **Local webhook testing:** requires a public HTTPS tunnel (e.g., ngrok, or any equivalent) pointed at your local backend during development, since Razorpay cannot deliver webhooks to `localhost` directly. Configure the tunnel URL + `/api/webhooks/razorpay` as the webhook endpoint in your Razorpay test-mode dashboard, subscribed to at least the `payment_link.paid` event (this is the event that confirms a Payment Link was actually paid).
- **Environment/config:** `.env` — Gemini key, Razorpay test key ID + secret, Razorpay webhook secret, MongoDB URI.

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
│   │   │   └── policyGuard.js
│   │   ├── execution/
│   │   │   ├── simulatedExecutor.js
│   │   │   └── razorpayExecutor.js
│   │   ├── orchestrator/
│   │   │   ├── caseOrchestrator.js
│   │   │   └── jobManager.js
│   │   ├── webhooks/
│   │   │   └── razorpayWebhook.js
│   │   ├── models/
│   │   │   ├── Case.js
│   │   │   └── ProcessedWebhookEvent.js
│   │   ├── routes/
│   │   │   ├── cases.js
│   │   │   ├── approvals.js
│   │   │   ├── jobs.js
│   │   │   └── webhooks.js
│   │   ├── data/
│   │   │   ├── generateSyntheticData.js
│   │   │   └── demoFixtures.js
│   │   ├── config/
│   │   │   ├── geminiClient.js
│   │   │   └── razorpayClient.js
│   │   ├── utils/
│   │   │   └── seededRandom.js       # NEW — deterministic outcome generation
│   │   └── server.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CaseTable.jsx
│   │   │   ├── CaseDetailTrace.jsx
│   │   │   ├── ApprovalQueue.jsx
│   │   │   ├── SummaryCard.jsx       # now shows TWO metrics, not one
│   │   │   └── BatchRunProgress.jsx
│   │   ├── api/client.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
└── README.md
```

---

## 3. Environment Variables

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

## 4. Amount Convention (unchanged, still non-negotiable)

Store and reason about amounts in **whole rupees everywhere**. Only `razorpayExecutor.js` converts to paise, only at the exact Razorpay API call, multiplying by 100 there and nowhere else. Comment this rule directly above that line of code.

---

## 5. Data Model — `backend/src/models/Case.js`

```js
{
  case_type: { type: String, enum: ["failed_payment", "abandoned_checkout"], required: true },

  amount: { type: Number, required: true }, // ALWAYS whole rupees
  currency: { type: String, default: "INR" },
  customer_id: { type: String, required: true },
  is_repeat_buyer: { type: Boolean, default: false },
  attempt_number: { type: Number, default: 1 },
  failure_reason_raw: { type: String },
  created_at: { type: Date, default: Date.now },

  // --- Consent / compliance fields ---
  has_recovery_consent: { type: Boolean, default: false }, // CHANGED: default false, safety-first
  contact_count: { type: Number, default: 0 },
  last_contacted_at: { type: Date, default: null },
  max_contact_count: { type: Number, default: 2 },

  status: {
    type: String,
    enum: [
      "new", "processing",                                  // NEW: "processing" for atomic claim
      "diagnosed", "valued", "planned", "policy_checked",
      "approved", "needs_merchant_approval",
      "link_created", "awaiting_payment",
      "recovered",
      "unrecovered_expired",                                 // NEW: replaces misuse of execution_failed
      "execution_failed",                                    // now reserved for actual API/network/executor errors
      "blocked_stop_rule", "stopped_safely", "blocked_no_consent"
    ],
    default: "new"
  },

  diagnosis: {
    failure_class: {
      type: String,
      enum: ["insufficient_funds", "expired_card", "technical_decline", "bank_error", "checkout_abandoned", "unknown"]
    },
    confidence: { type: Number, min: 0, max: 1 },
    reasoning: String
  },

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
    confidence: { type: Number, min: 0, max: 1 },
    discount_requested_pct: { type: Number, default: 0, min: 0, max: 100 }
  },

  policy_check: {
    decision: { type: String, enum: ["APPROVED", "REJECTED_FALLBACK", "NEEDS_MERCHANT_APPROVAL", "BLOCKED_STOP_RULE", "BLOCKED_NO_CONSENT"] },
    reason: String,
    fallback_action: String
  },

  fallback_policy_check: {                                  // NEW — result of re-checking policy on the fallback plan
    decision: { type: String, enum: ["APPROVED", "NEEDS_MERCHANT_APPROVAL", "BLOCKED_STOP_RULE"] },
    reason: String
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
    timestamp: Date,
    agent_errors: [String]                                  // NEW — records which agent(s) fell back due to Gemini failure
  },

  demo_case: { type: Boolean, default: false },

  audit_log: [
    { stage: String, timestamp: { type: Date, default: Date.now }, output: Object }
  ]
}
```

`ProcessedWebhookEvent.js` — unchanged from v2 (dedup table, `razorpay_event_id` unique).

---

## 6. Agents & Policy — Full Schemas (restored detail)

### 6.1 `diagnosisAgent.js`

`diagnoseCase(caseData)`:
- Input to the prompt: `case_type`, `failure_reason_raw`, `attempt_number`.
- **Exact output schema** (enforce via Gemini's `responseSchema`, and re-validate in code after parsing):
```json
{
  "failure_class": "insufficient_funds | expired_card | technical_decline | bank_error | checkout_abandoned | unknown",
  "confidence": "number, 0.0 to 1.0 inclusive",
  "reasoning": "string, 1-2 sentences"
}
```
- Code-side validation: `failure_class` must be one of the 6 exact values (case-sensitive) — if not, coerce to `"unknown"`. `confidence` must be a number between 0 and 1 — if missing/out of range, coerce to `0`. If the response fails to parse as JSON at all, treat as a full agent failure (see Section 6.6, Gemini fallback behavior) rather than guessing.

### 6.2 `valueAgent.js`

`assessValue(caseData)`:
- Input: `amount`, `is_repeat_buyer`, `attempt_number`, `case_type`.
- **Exact output schema:**
```json
{
  "priority": "high | medium | low",
  "cart_value": "number, equal to caseData.amount (agent should echo it back, used as a sanity check)",
  "is_repeat_buyer": "boolean, should match caseData.is_repeat_buyer",
  "attempt_number": "number, should match caseData.attempt_number"
}
```
- Code-side validation: `priority` must be one of the 3 exact values, default to `"low"` if invalid. Cross-check `cart_value`/`is_repeat_buyer`/`attempt_number` against the original `caseData` — if the agent's echoed values don't match, trust the original `caseData`, not the agent's echo (the agent's job is to judge priority, not to be a second source of truth for these fields).

### 6.3 `plannerAgent.js`

`planRecovery(caseData, diagnosis, valueAssessment)`:
- Input: full diagnosis + value assessment objects as context, plus a hard instruction listing the exact 5 allowed actions and stating the agent may not invent a sixth.
- **Exact output schema:**
```json
{
  "recommendation": "CREATE_PAYMENT_LINK | SEND_REMINDER | OFFER_DISCOUNT | ESCALATE_TO_HUMAN | DO_NOT_CONTACT",
  "reasoning": "string, 1-2 sentences",
  "confidence": "number, 0.0 to 1.0 inclusive",
  "discount_requested_pct": "number, 0 to 100, should be 0 unless recommendation is OFFER_DISCOUNT"
}
```
- Code-side validation: `recommendation` must be one of the 5 exact values — if not, force to `"ESCALATE_TO_HUMAN"` (safest fallback, never silently drop to `DO_NOT_CONTACT`, since that discards a possibly-recoverable case without human visibility). `confidence` clamped to [0,1]. `discount_requested_pct` clamped to [0,100]; if `recommendation !== "OFFER_DISCOUNT"`, force `discount_requested_pct = 0` regardless of what the agent returned.

All three agents: use Gemini's `responseMimeType: "application/json"` + `responseSchema` matching the shapes above exactly, so malformed output is minimized at the API level before your code-side validation runs as a second layer of defense.

### 6.4 `policyGuard.js` — rule set (unchanged from v2, still correct)

```
CONSTANTS:
  MAX_ATTEMPTS = 3
  MIN_RECOVERABLE_AMOUNT = 100
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
       RETURN { decision: "REJECTED_FALLBACK", reason: "Discount exceeds maximum allowable ceiling (5%)", fallback_action: "CREATE_PAYMENT_LINK" }
  5. IF plan.discount_requested_pct > AUTO_APPROVE_DISCOUNT_MAX_PCT AND plan.discount_requested_pct <= APPROVAL_DISCOUNT_MAX_PCT:
       RETURN { decision: "NEEDS_MERCHANT_APPROVAL", reason: "Any discount (1-5%) requires merchant approval" }
  6. IF plan.confidence < MIN_CONFIDENCE_AUTO_APPROVE:
       RETURN { decision: "NEEDS_MERCHANT_APPROVAL", reason: "Planner confidence below auto-approve threshold" }
  7. OTHERWISE:
       RETURN { decision: "APPROVED", reason: "Within policy limits" }
```

### 6.5 Fallback handling — corrected to re-check policy

When `policy_check.decision === "REJECTED_FALLBACK"`:
```
1. Build fallbackPlan = { recommendation: "CREATE_PAYMENT_LINK", discount_requested_pct: 0, confidence: plan.confidence, reasoning: "Fallback: original plan rejected, downgraded to plain payment link" }
2. Run checkPolicy(caseData, fallbackPlan) AGAIN — this is a fresh, independent check (fixes v2's bug of silently approving the fallback)
3. Save this second result to case.fallback_policy_check
4. Branch on the SECOND check's decision:
     - "APPROVED" → proceed to execution as normal
     - "NEEDS_MERCHANT_APPROVAL" → route to merchant approval queue (e.g., if confidence was also low)
     - "BLOCKED_STOP_RULE" → status = "stopped_safely" (e.g., if attempt cap was also hit)
5. Log BOTH policy_check and fallback_policy_check in audit_log — this two-step gate is one of your strongest demo moments
```

### 6.6 Executors

**`simulatedExecutor.js`** — deterministic, not random:
- For `CREATE_PAYMENT_LINK`/`OFFER_DISCOUNT`: generates `sim_plink_<caseId>`, sets `payment_link_status = "created"`, `status = "link_created"`.
- **Outcome determinism (fixed):** use `backend/src/utils/seededRandom.js` — a simple seeded PRNG (e.g., hash `case._id` string to a number, use it to seed a deterministic pseudo-random generator such as `mulberry32`) instead of `Math.random()`. The same case always resolves to the same simulated outcome on every run (paid ~60-70% of the time, unresolved otherwise), so your batch recovery figure is stable and reproducible, not different every time you click "Run Batch."
- Unresolved simulated links: leave `status = "link_created"` (not paid, not expired — just simulating an outstanding link) or optionally simulate expiry the same deterministic way, setting `status = "unrecovered_expired"`.
- Increments `contact_count`, sets `last_contacted_at` on contact-type actions.

**`razorpayExecutor.js`** — real API, 2-3 cases only:
- Converts rupees → paise only here.
- Sets `status = "awaiting_payment"` after creating the link — never `"recovered"` directly.
- Webhook (Section 7) is the only thing that can set `status = "recovered"` or `status = "unrecovered_expired"` for these cases.

### 6.7 Gemini failure / rate-limit handling (new)

Wrap every agent call (`diagnoseCase`, `assessValue`, `planRecovery`) in a try/catch. On any Gemini error (network failure, rate limit, malformed/unparseable response after retry):
```
1. Push the error message to case.execution.agent_errors (e.g., "diagnosisAgent: rate_limited")
2. Use a safe deterministic fallback for that stage's output:
     - diagnosisAgent failure → { failure_class: "unknown", confidence: 0, reasoning: "agent_error_fallback" }
     - valueAgent failure → { priority: "low", cart_value: caseData.amount, is_repeat_buyer: caseData.is_repeat_buyer, attempt_number: caseData.attempt_number }
     - plannerAgent failure → { recommendation: "ESCALATE_TO_HUMAN", reasoning: "agent_error_fallback", confidence: 0, discount_requested_pct: 0 }
3. Continue the pipeline with the fallback value rather than crashing the whole case or the whole batch job
4. Because plannerAgent's fallback is ESCALATE_TO_HUMAN with confidence 0, the Policy Guard's existing confidence rule (Section 6.4, rule 6) will naturally route it to NEEDS_MERCHANT_APPROVAL — no special-case policy logic needed for this
```
Add a simple retry-once-with-backoff before falling back (e.g., wait 1-2 seconds, retry the same call once) to smooth over transient rate-limit blips without immediately giving up — but don't retry more than once per stage, to keep batch runtime predictable.

---

## 7. Webhook Handling — `backend/src/webhooks/razorpayWebhook.js`

**Critical setup requirement:** the Express route for `/api/webhooks/razorpay` must use **raw body parsing** (`express.raw({ type: 'application/json' })`) applied specifically to that route, mounted *before* any global `express.json()` middleware would otherwise consume and reformat the body. If the global JSON parser touches the body first, the raw bytes needed for HMAC verification are gone and signature checks will fail unpredictably. Mount the raw-body middleware narrowly on this one route; leave the rest of the app using normal `express.json()`.

Flow:
1. Compute HMAC-SHA256 of the raw request body using `RAZORPAY_WEBHOOK_SECRET`, compare against the `X-Razorpay-Signature` header. Reject with 400 on mismatch.
2. Check `ProcessedWebhookEvent` for the event's `id` — if present, return 200 immediately (dedup).
3. If new, insert into `ProcessedWebhookEvent`, then handle:
   - `payment_link.paid` → find `Case` by `execution.razorpay_reference`, set `payment_link_status = "paid"`, `status = "recovered"`, audit_log push.
   - `payment_link.expired` / `payment_link.cancelled` → set `payment_link_status` accordingly, **`status = "unrecovered_expired"`** (not `execution_failed` — the executor did its job; the customer simply didn't pay), audit_log push.
4. Return 200 quickly.

**Live setup (concrete):** expose your local backend via a public HTTPS tunnel (e.g., ngrok) during development, or use your actual deployment URL if hosted. Configure that URL + `/api/webhooks/razorpay` in the Razorpay test-mode dashboard's webhook settings, subscribed to at least `payment_link.paid` (add `payment_link.expired`/`cancelled` too if you want the full unrecovered-expired path to work for real demo cases).

---

## 8. Deterministic Demo Mode

Unchanged from v2: `demoFixtures.js` with hardcoded outputs keyed by fixed `customer_id`s, `DEMO_MODE=true` env toggle checked at the top of each agent-calling step in the orchestrator, used only for your 3 scripted live-demo cases.

---

## 9. Atomic Case Claiming for Batch Runs (new)

To prevent double-processing if "Run Batch" is triggered twice (e.g., accidental double-click, or a retry after a perceived failure):

```
Before invoking any agent for a case, atomically claim it:

  result = Case.findOneAndUpdate(
    { _id: caseId, status: "new" },
    { $set: { status: "processing" } },
    { new: true }
  )

  IF result is null:
    // another job already claimed this case (status was no longer "new") — skip it, do not reprocess
    RETURN skip

  ELSE:
    // this job now owns the case — proceed with the pipeline
    continue processing normally, moving through "diagnosed" → "valued" → etc.
```

This uses MongoDB's atomic `findOneAndUpdate` (only one caller can successfully transition a given document from `"new"` to `"processing"` even under concurrent requests) — no additional locking library needed. Apply this same claim check inside `jobManager.js`'s batch loop before calling `processCase`.

---

## 10. Background Job for Batch Runs

Unchanged from v2, with the addition that `jobManager.js` now calls the atomic claim (Section 9) before processing each case, and skips already-claimed cases rather than erroring.

---

## 11. Frontend — Metrics Display (corrected)

**`SummaryCard.jsx` must show two separate, clearly labeled figures — never combine them:**

```
┌─────────────────────────────────────────┐
│  Simulated Batch Recovery                │
│  ₹46,800 recovered / ₹78,200 at risk     │
│  across 100 synthetic cases              │
│  (seeded, deterministic outcomes)        │
├─────────────────────────────────────────┤
│  Verified Razorpay Test-Mode Recovery    │
│  ₹2,499 recovered / 1 of 3 demo links    │
│  paid (real Razorpay webhook-confirmed)  │
└─────────────────────────────────────────┘
```

Never sum these into one number in the UI or in your demo narration — always refer to them by name ("simulated batch figure" vs. "verified real recovery") so judges immediately understand which is which. This distinction is itself a good thing to point out proactively in your demo — it signals rigor rather than something to hide.

Other components (`CaseTable`, `CaseDetailTrace`, `ApprovalQueue`, `BatchRunProgress`) unchanged from v2, styled with Tailwind, with new status colors added: `unrecovered_expired` (orange/amber, distinct from red `execution_failed`), `processing` (blue/in-progress).

---

## 12. Scope Changes for v1 (unchanged from v2)

`failed_subscription`/`RETRY_SUBSCRIPTION` still dropped from v1 scope. `failed_payment` and `abandoned_checkout` remain the two case types.

---

## 13. Synthetic Data Generator — corrected

Generate 40-100 cases. Include:
- Variation across `case_type`, `amount`, `attempt_number`, `is_repeat_buyer`.
- `has_recovery_consent`: mix of `true`/`false` — **remember the schema default is now `false`, so explicitly set `true` on most synthetic records or nothing will ever process**; include a deliberate few left `false` to demonstrate the consent-block rule.
- A few cases with `contact_count` already at `max_contact_count`, to demonstrate the stop rule independent of `attempt_number`.
- Exactly 3 cases flagged `demo_case: true` with fixed `customer_id`s matching `demoFixtures.js` keys.

---

## 14. Build Order

1. Scaffold `backend/` and `frontend/` (Tailwind) per Section 2.
2. `.env`, MongoDB connection, `Case` + `ProcessedWebhookEvent` schemas (Section 5).
3. Build `seededRandom.js` utility first — test it standalone to confirm the same input always produces the same output.
4. Build synthetic data generator, remembering the consent-default-false note (Section 13).
5. Build `diagnosisAgent.js` + `valueAgent.js` with full schema validation (Section 6.1-6.2), test standalone, including forcing a fake error to confirm the fallback path works.
6. Build `plannerAgent.js` (Section 6.3), same testing approach.
7. Build `policyGuard.js` (Section 6.4) — manually test every rule branch.
8. Build the fallback re-check logic (Section 6.5) as its own tested function before wiring into the orchestrator.
9. Build `simulatedExecutor.js` using the seeded RNG — verify determinism by running it twice on the same case and confirming identical output.
10. Build `razorpayExecutor.js` — one real manual test-mode Payment Link before integrating.
11. Build `razorpayWebhook.js` with raw-body middleware (Section 7) — test signature verification with a manually crafted payload first, then set up the real tunnel + Razorpay dashboard webhook config.
12. Build `caseOrchestrator.js` wiring everything together, including the atomic claim (Section 9) and Gemini fallback handling (Section 6.7). Run against the 3 demo cases first.
13. Build `jobManager.js` + batch API routes with atomic claiming.
14. Build demo fixtures + `DEMO_MODE` toggle.
15. Build frontend, including the two-metric `SummaryCard` (Section 11).
16. Run the full batch with `DEMO_MODE=false`, confirm the simulated figure is stable across repeated runs (determinism check). Run the 2-3 real demo cases through `razorpayExecutor`, manually pay the test-mode links, confirm the webhook correctly flips them to `"recovered"`.
17. Polish, README, confirm `.env.example` has no real secrets.

---

## 15. What to Read and Study

| Topic | What to read | Why |
|---|---|---|
| Razorpay Payment Links API | Official docs, Payment Links section, test-mode link-count limits | Core execution mechanism |
| Razorpay amount/currency conventions | Same doc — subunit (paise) requirement | Prevents amount bugs |
| Razorpay Webhooks | Official docs — webhook setup, signature verification, event types, specifically `payment_link.paid`/`expired`/`cancelled` | New territory, budget real time |
| Express raw-body middleware for webhooks | Express docs on `express.raw()`, or any "webhook signature verification Express" guide | Needed to avoid the silent signature-verification bug (Section 7) |
| Gemini API structured output | Google AI docs on `responseMimeType`/`responseSchema` | Reliable agent parsing |
| Gemini rate limits (free tier) | Google AI's rate-limit documentation for your specific model tier | Needed to size your retry/fallback strategy realistically (Section 6.7) |
| Mongoose nested schemas + arrays, atomic `findOneAndUpdate` | Mongoose docs on nested objects/arrays; MongoDB docs on `findOneAndUpdate` atomicity | For `audit_log` and the atomic case-claim pattern (Section 9) |
| Seeded/deterministic PRNGs in JS | Search "mulberry32 seeded random javascript" or similar small deterministic PRNG snippet | For `seededRandom.js` |
| Tailwind + Vite setup | Tailwind's official Vite integration guide | Quick setup reference |
| Node async concurrency in chunks | "Promise.all in batches" pattern | For `jobManager.js` |

New study items this round: **Express raw-body middleware for webhooks**, **Gemini's documented rate limits**, and a **seeded PRNG snippet** (all small, quick reads — not deep study).

---

## What Changed From v2 (this round's fixes)

1. Simulated batch figure and verified real-money figure are now always reported separately, never combined; simulated outcomes are seeded/deterministic (via `case._id`) instead of `Math.random()`, so results are reproducible.
2. Fallback actions now re-run through `checkPolicy()` a second time and only execute if that second check also passes — closes the bypass where a rejected discount could skip the confidence check.
3. `has_recovery_consent` now defaults to `false` (safety-first); synthetic data generator must explicitly opt cases in.
4. Added atomic case-claiming (`findOneAndUpdate` from `"new"` to `"processing"`) to prevent double-processing on repeated batch triggers.
5. Added `unrecovered_expired` status, separate from `execution_failed` — an expired/cancelled link is a customer outcome, not a system failure.
6. Added explicit raw-body middleware requirement for the webhook route, mounted before global JSON parsing, to make signature verification actually work.
7. Added concrete live webhook setup instructions (public HTTPS tunnel + Razorpay dashboard config + required event subscription).
8. Restored full exact JSON schemas and code-side validation rules for all three agents (was under-specified in v2).
9. Added Gemini failure/rate-limit handling: retry-once, then deterministic safe fallback per agent, logged to `agent_errors`, naturally routed to merchant approval via the existing confidence rule.

*(v2's own changelog vs. the original v1 draft is preserved in that document if you need the earlier history.)*
