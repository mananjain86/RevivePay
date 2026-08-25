# RecoverFlow — Build Instructions for Antigravity IDE

This document is written to be pasted directly into Antigravity (or given section-by-section) as build instructions. It assumes the agent building this has no prior context beyond what's written here — every requirement, file, and data shape is spelled out explicitly.

---

## 0. Project Summary (give this first, always)

Build **RecoverFlow**, a multi-agent revenue recovery system for a fintech buildathon (Razorpay Track 3: AI Revenue Recovery). It processes a batch of failed payments, failed subscription renewals, and abandoned checkouts. For each case, it runs a pipeline of AI agents to diagnose the failure, assess recovery value, and recommend an action — but the actual money-moving decision is gated by deterministic policy code, not by the AI directly. Approved actions execute against Razorpay's test-mode APIs. Every stage is logged to build a full audit trail. The system reports a real recovered-revenue number across the batch and includes a merchant-approval queue for higher-risk actions.

**Non-negotiable architecture rule:** The AI (LLM) agents only ever *recommend*. A separate, plain deterministic code module (the Policy Guard) is the only thing allowed to approve an action before it executes. Never let an LLM call directly trigger a Razorpay API call.

---

## 1. Tech Stack (use exactly this — do not substitute)

- **Frontend:** React (Vite), plain CSS or a lightweight utility approach — no need for a heavy design system
- **Backend:** Node.js + Express
- **Database:** MongoDB (use Mongoose for schema modeling)
- **AI:** Anthropic API (Claude) via `@anthropic-ai/sdk`, using structured/JSON-forced output for every agent call
- **Payments:** Razorpay Node SDK, test-mode only, using the Payment Links API (primary) and Subscriptions API (for the subscription-failure case type)
- **Environment/config:** `.env` file for API keys (Anthropic key, Razorpay test key ID + secret, MongoDB connection string) — never hardcode keys

---

## 2. Repository Structure

Set up the project with this structure:

```
recoverflow/
├── backend/
│   ├── src/
│   │   ├── agents/
│   │   │   ├── diagnosisAgent.js
│   │   │   ├── valueAgent.js
│   │   │   └── plannerAgent.js
│   │   ├── policy/
│   │   │   └── policyGuard.js          # deterministic, no LLM calls allowed in this file
│   │   ├── execution/
│   │   │   └── actionExecutor.js       # Razorpay API calls live here
│   │   ├── orchestrator/
│   │   │   └── caseOrchestrator.js     # runs a case through the full pipeline, updates status + audit_log
│   │   ├── models/
│   │   │   └── Case.js                 # Mongoose schema (see section 4)
│   │   ├── routes/
│   │   │   ├── cases.js                # GET/POST endpoints for cases
│   │   │   └── approvals.js            # approve/reject endpoints for the merchant queue
│   │   ├── data/
│   │   │   └── generateSyntheticData.js
│   │   ├── config/
│   │   │   ├── anthropicClient.js
│   │   │   └── razorpayClient.js
│   │   └── server.js
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CaseTable.jsx
│   │   │   ├── CaseDetailTrace.jsx     # renders audit_log as a timeline
│   │   │   ├── ApprovalQueue.jsx
│   │   │   └── SummaryCard.jsx         # total at-risk vs recovered
│   │   ├── api/
│   │   │   └── client.js               # fetch wrappers for backend endpoints
│   │   ├── App.jsx
│   │   └── main.jsx
│   └── package.json
└── README.md
```

---

## 3. Environment Variables (`.env.example` in `backend/`)

```
ANTHROPIC_API_KEY=your_key_here
RAZORPAY_KEY_ID=your_test_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
MONGODB_URI=mongodb://localhost:27017/recoverflow
PORT=5000
```

---

## 4. Data Model — `backend/src/models/Case.js`

Build a Mongoose schema matching this shape exactly:

```js
{
  case_type: { type: String, enum: ["failed_payment", "failed_subscription", "abandoned_checkout"], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  customer_id: { type: String, required: true },
  is_repeat_buyer: { type: Boolean, default: false },
  attempt_number: { type: Number, default: 1 },
  failure_reason_raw: { type: String },
  created_at: { type: Date, default: Date.now },

  status: {
    type: String,
    enum: [
      "new", "diagnosed", "valued", "planned", "policy_checked",
      "approved", "needs_merchant_approval", "executed",
      "recovered", "execution_failed", "blocked_stop_rule", "stopped_safely"
    ],
    default: "new"
  },

  diagnosis: {
    failure_class: String,
    confidence: Number,
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
      enum: ["CREATE_PAYMENT_LINK", "RETRY_SUBSCRIPTION", "SEND_REMINDER", "OFFER_DISCOUNT", "ESCALATE_TO_HUMAN", "DO_NOT_CONTACT"]
    },
    reasoning: String,
    confidence: Number,
    discount_requested_pct: { type: Number, default: 0 }
  },

  policy_check: {
    decision: { type: String, enum: ["APPROVED", "REJECTED_FALLBACK", "NEEDS_MERCHANT_APPROVAL", "BLOCKED_STOP_RULE"] },
    reason: String,
    fallback_action: String
  },

  merchant_approval: {
    required: { type: Boolean, default: false },
    approved_by_merchant: { type: Boolean, default: null },
    approved_at: Date
  },

  execution: {
    action_taken: String,
    result: { type: String, enum: ["success", "failure", "not_attempted"], default: "not_attempted" },
    razorpay_reference: String,
    timestamp: Date
  },

  audit_log: [
    {
      stage: String,
      timestamp: { type: Date, default: Date.now },
      output: Object
    }
  ]
}
```

---

## 5. Build Each Agent — Exact Instructions

### 5.1 `backend/src/agents/diagnosisAgent.js`

Build a function `diagnoseCase(caseData)` that:
- Calls the Anthropic API with a system prompt instructing it to act as a payment-failure diagnosis specialist.
- Passes in `case_type`, `failure_reason_raw`, `attempt_number`.
- **Forces JSON-only output** matching: `{ "failure_class": string, "confidence": number (0-1), "reasoning": string }`
- `failure_class` must be one of: `insufficient_funds`, `expired_card`, `technical_decline`, `bank_error`, `checkout_abandoned`, `unknown`.
- Parses the response; if parsing fails, default to `{ failure_class: "unknown", confidence: 0, reasoning: "parse_failure" }` and log this fallback — never throw an unhandled error.
- Returns the parsed object. The Orchestrator will attach it to `case.diagnosis` and push a stage entry to `audit_log`.

### 5.2 `backend/src/agents/valueAgent.js`

Build a function `assessValue(caseData)` that:
- Calls the Anthropic API with a system prompt instructing it to assess recovery priority.
- Passes in `amount`, `is_repeat_buyer`, `attempt_number`, `case_type`.
- **Forces JSON-only output** matching: `{ "priority": "high"|"medium"|"low", "cart_value": number, "is_repeat_buyer": boolean, "attempt_number": number }`
- Same parse-failure fallback pattern as above (default to `"low"` priority on failure).

### 5.3 `backend/src/agents/plannerAgent.js`

Build a function `planRecovery(caseData, diagnosis, valueAssessment)` that:
- Calls the Anthropic API with a system prompt listing the **fixed allowed action set**: `CREATE_PAYMENT_LINK`, `RETRY_SUBSCRIPTION`, `SEND_REMINDER`, `OFFER_DISCOUNT`, `ESCALATE_TO_HUMAN`, `DO_NOT_CONTACT`. Instruct it explicitly: it may only choose ONE action from this exact list, never invent a new one.
- Passes in the diagnosis and value assessment as context.
- **Forces JSON-only output** matching: `{ "recommendation": string, "reasoning": string, "confidence": number, "discount_requested_pct": number }`
- Validate on the code side that `recommendation` is actually one of the six allowed values — if not, force it to `ESCALATE_TO_HUMAN` as a safe fallback.

**For all three agents:** use Claude's structured output approach — either a strict system prompt demanding "respond with ONLY valid JSON, no other text" combined with a JSON parse + regex strip of markdown fences, or Anthropic's tool-use feature where you define a tool schema and force `tool_choice`. Prefer the tool-use approach if you're able to set it up — it's more reliable than prompt-only JSON enforcement.

### 5.4 `backend/src/policy/policyGuard.js` — CRITICAL, READ CAREFULLY

This file must contain **zero LLM calls**. It is pure deterministic logic. Build a function `checkPolicy(caseData, plan)` that applies these rules in order:

```
1. IF caseData.attempt_number >= 3:
     RETURN { decision: "BLOCKED_STOP_RULE", reason: "Retry/contact cap reached (max 3 attempts)" }

2. IF caseData.amount < 100:
     RETURN { decision: "BLOCKED_STOP_RULE", reason: "Amount below minimum recovery threshold" }

3. IF plan.discount_requested_pct > 5:
     RETURN { decision: "NEEDS_MERCHANT_APPROVAL", reason: "Discount exceeds 5% auto-approve ceiling" }

4. IF plan.confidence < 0.6:
     RETURN { decision: "NEEDS_MERCHANT_APPROVAL", reason: "Planner confidence below auto-approve threshold" }

5. IF plan.recommendation === "OFFER_DISCOUNT" AND plan.discount_requested_pct > 0:
     RETURN { decision: "NEEDS_MERCHANT_APPROVAL", reason: "Any discount offer requires merchant approval" }

6. OTHERWISE:
     RETURN { decision: "APPROVED", reason: "Within policy limits" }
```

These exact numeric thresholds (3 attempts, ₹100 minimum, 5% discount ceiling, 0.6 confidence) are the project's defaults — they can be tuned later, but implement them as named constants at the top of the file (e.g., `MAX_ATTEMPTS = 3`) so they're easy to find and adjust.

### 5.5 `backend/src/execution/actionExecutor.js`

Build a function `executeAction(caseData, plan, policyResult)` that:
- Only runs if `policyResult.decision === "APPROVED"`.
- Switches on `plan.recommendation`:
  - `CREATE_PAYMENT_LINK` → call Razorpay's Payment Links API (test mode) to create a real payment link for `caseData.amount`.
  - `RETRY_SUBSCRIPTION` → call Razorpay's Subscriptions API to attempt a renewal retry.
  - `SEND_REMINDER` / `OFFER_DISCOUNT` (post-approval) → simulate by logging a drafted message string (no real send needed) plus, for `OFFER_DISCOUNT`, still create a Razorpay Payment Link with the discount applied to the amount.
  - `ESCALATE_TO_HUMAN` / `DO_NOT_CONTACT` → no external call, just log the outcome as `not_attempted` with a reason.
- Returns `{ result: "success"|"failure", razorpay_reference, timestamp }`.
- Wrap all Razorpay calls in try/catch — on failure, return `{ result: "failure", ... }` and never let it crash the orchestrator.

### 5.6 `backend/src/orchestrator/caseOrchestrator.js`

Build a function `processCase(caseId)` that:
1. Loads the case from MongoDB.
2. Calls `diagnoseCase`, saves result to `case.diagnosis`, sets `status = "diagnosed"`, pushes an `audit_log` entry.
3. Calls `assessValue`, saves to `case.value_assessment`, sets `status = "valued"`, pushes `audit_log` entry.
4. Calls `planRecovery`, saves to `case.plan`, sets `status = "planned"`, pushes `audit_log` entry.
5. Calls `checkPolicy` (no async needed, it's synchronous), saves to `case.policy_check`, sets `status = "policy_checked"`, pushes `audit_log` entry.
6. Branches on `policy_check.decision`:
   - `APPROVED` → set `status = "approved"`, call `executeAction`, save result to `case.execution`, set `status` to `"recovered"` if execution succeeded or `"execution_failed"` if not, push final `audit_log` entry.
   - `NEEDS_MERCHANT_APPROVAL` → set `status = "needs_merchant_approval"`, set `merchant_approval.required = true`, stop here (wait for a human).
   - `BLOCKED_STOP_RULE` → set `status = "stopped_safely"`, push `audit_log` entry, stop — never contact this case again.
7. Save the case document after every step (or batch-save at the end — either is fine, but the `audit_log` array must capture every step regardless).

Build a second function `resolveApproval(caseId, approvedByMerchant)` for when a human acts on a `needs_merchant_approval` case:
- If approved: set `merchant_approval.approved_by_merchant = true`, then call `executeAction` and finish the pipeline as in step 6 above.
- If rejected: set `status = "stopped_safely"`, `merchant_approval.approved_by_merchant = false`, push an `audit_log` entry, stop.

### 5.7 Batch runner

Build a script or endpoint that runs `processCase` across every case in the database with `status: "new"`, sequentially or with limited concurrency (don't fire 50 simultaneous Anthropic + Razorpay calls at once — batch in groups of 5-10 to avoid rate limits).

---

## 6. API Routes (`backend/src/routes/`)

Build these Express endpoints:

- `GET /api/cases` — returns all cases, supports a `?status=` query filter
- `GET /api/cases/:id` — returns a single case with full `audit_log`
- `POST /api/cases/run-batch` — triggers the batch runner across all `"new"` cases
- `GET /api/cases/summary` — returns aggregate stats: total at-risk amount, total recovered amount, count by status
- `POST /api/approvals/:id/approve` — calls `resolveApproval(id, true)`
- `POST /api/approvals/:id/reject` — calls `resolveApproval(id, false)`

---

## 7. Synthetic Data Generator (`backend/src/data/generateSyntheticData.js`)

Build a script that inserts ~40-50 case documents into MongoDB, with realistic variation across `case_type`, `amount`, `attempt_number`, `is_repeat_buyer`, and `failure_reason_raw`. **Explicitly include these three guaranteed cases** (use fixed, recognizable values so they're easy to find in the demo):

1. **Clean auto-recovery case:** `case_type: "failed_payment"`, `amount: 2499`, `attempt_number: 1`, `is_repeat_buyer: true`, `failure_reason_raw: "UPI payment failed - bank timeout"` — should flow through to `APPROVED` → `recovered`.
2. **Safe-stop case:** `case_type: "failed_payment"`, `amount: 5000`, `attempt_number: 3`, `failure_reason_raw: "Card declined - repeated failures"` — should hit `BLOCKED_STOP_RULE`.
3. **Human-approval case:** `case_type: "abandoned_checkout"`, `amount: 8000`, `attempt_number: 1`, engineered so the Planner is likely to recommend `OFFER_DISCOUNT` (you can nudge this by adding a note in the synthetic data like `"cart abandoned at payment step, high value"` that signals discount-worthy hesitation) — should hit `NEEDS_MERCHANT_APPROVAL`.

---

## 8. Frontend — Exact Instructions

### 8.1 `SummaryCard.jsx`
Fetch `/api/cases/summary` and display: total at-risk ₹ amount, total recovered ₹ amount, recovery rate %, count of cases by status (small badge row: recovered / stopped safely / pending approval / execution failed).

### 8.2 `CaseTable.jsx`
Fetch `/api/cases`, render a table: case type, amount, status (color-coded badge), attempt number, a "View Trace" button per row. Support filtering by status via dropdown.

### 8.3 `CaseDetailTrace.jsx`
Given a case ID, fetch `/api/cases/:id` and render `audit_log` as a vertical timeline — each stage as a card showing the stage name, timestamp, and its output JSON in a readable format (not raw JSON dump — format key fields like `reasoning` and `decision` prominently).

### 8.4 `ApprovalQueue.jsx`
Fetch cases with `status=needs_merchant_approval`. For each, show the case details, the Planner's recommendation and reasoning, and two buttons: Approve / Reject, calling the corresponding endpoints. Refresh the list after each action.

### 8.5 `App.jsx`
Simple layout: `SummaryCard` at top, tabs or sections for "All Cases" (`CaseTable`), "Pending Approvals" (`ApprovalQueue`), and a modal or side panel for `CaseDetailTrace` when a case is selected. Add a "Run Batch" button that calls `POST /api/cases/run-batch` and shows a loading state while it processes.

---

## 9. Build Order (give this to Antigravity as the execution sequence)

1. Scaffold both `backend/` and `frontend/` with the structure in Section 2.
2. Set up `.env`, MongoDB connection, and the `Case` Mongoose schema.
3. Build and test the synthetic data generator — verify the three guaranteed cases insert correctly.
4. Build `diagnosisAgent.js` — test it standalone against a few sample cases, confirm JSON parses reliably.
5. Build `valueAgent.js` — same testing approach.
6. Build `plannerAgent.js` — same testing approach.
7. Build `policyGuard.js` — write unit-style manual tests for each of the 6 rule branches to confirm the logic is correct before wiring it into the pipeline.
8. Build `actionExecutor.js` — get Razorpay Payment Links creation working with a single manual test call before integrating.
9. Build `caseOrchestrator.js` wiring all of the above together — run it against the three guaranteed cases first and confirm each lands in the correct final status.
10. Build the API routes.
11. Build the frontend components in this order: `CaseTable` → `SummaryCard` → `CaseDetailTrace` → `ApprovalQueue`.
12. Run the full batch, verify the aggregate numbers look right, verify the three guaranteed demo cases behave as expected end to end.
13. Polish UI, add loading/error states, and finalize the README with setup instructions.

---

## 10. What to Read and Study Before/While Building

| Topic | What specifically to read | Why |
|---|---|---|
| **Razorpay Payment Links API** | Razorpay's official developer docs, Payment Links section — creation, status check, test-mode behavior | This is your core execution mechanism; read this first, before writing any backend code |
| **Razorpay test-mode setup** | Razorpay dashboard docs on generating test API keys, and their test card/UPI reference page | You need working test credentials before Step 8 in the build order |
| **Razorpay Subscriptions API** | Razorpay docs, Subscriptions section | Only needed if you implement the `failed_subscription` case type's retry action — can be studied later, after Payment Links works |
| **Anthropic API — structured output / tool use** | Anthropic's API documentation, specifically the tool-use / forced-JSON-output guidance | Critical for making all three agents reliably parseable — read this before Step 4 |
| **Mongoose schema design (nested objects + arrays)** | Mongoose's official docs on schemas, specifically nested objects and array-of-object fields | Needed for the `audit_log` array and nested `diagnosis`/`plan`/etc. objects |
| **Express async route handling + error handling** | Any concise Express.js async/await + error-middleware guide | You'll have many async agent calls chained together; clean error handling prevents one bad LLM response from crashing the whole batch |
| **Rate limiting / batching async calls in Node** | Search for "Node.js limit concurrent async requests" (e.g., using a simple queue or `Promise.all` in chunks) | Needed for Step 7 (Section 5) — running 40-50 cases without hitting Anthropic/Razorpay rate limits |
| **React data fetching + polling patterns** | Standard React `useEffect` + fetch patterns you already know from CryptoGaze | Reused directly, just a refresher if needed |

You already have strong working knowledge of React, Express, and MongoDB from CryptoGaze — the genuinely new material to actually sit down and study is the **Razorpay API docs** and the **Anthropic structured-output/tool-use docs**. Everything else on this list is a quick reference-check while coding, not something to study in advance.
