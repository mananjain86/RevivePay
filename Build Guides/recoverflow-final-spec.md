# RecoverFlow — AI Revenue Recovery Agent
### Full Project Spec (Track 3, Razorpay Buildathon)

This document is the single source of truth for the project. It merges the best ideas from two design explorations into one final architecture, and is written so you can hand it to a fresh chat/session and start building immediately with no missing context.

---

## 1. What This Project Is

**One-line pitch:** A multi-agent system that watches a merchant's failed payments and abandoned checkouts, figures out why each one happened, decides on and safely executes a recovery action through Razorpay's test-mode APIs, and reports exactly how much revenue was recovered — with every decision logged, gated by policy, and explainable.

**Scope covered (merged from both designs):**
- Failed one-time payments (card declined, insufficient funds, expired card, technical/UPI failure)
- Failed subscription/mandate renewals
- Abandoned checkouts (cart started, not completed)

**Explicitly out of scope (don't build these — keep the project focused):**
- B2B receivables/invoice chasing (a good separate idea, not part of this build)
- Real SMS/WhatsApp/email delivery (simulate/log messages instead — no need for a real messaging provider)
- Real fraud detection (that's Track 2, not this project)

---

## 2. The Bar You're Being Judged Against

Direct from the brief: *"Don't just identify the problem. Show measured money recovered across a batch, with compliant escalation, stopping rules, and an audit trail."*

Your final demo must show, concretely:
1. **A real number** — recovered ₹X out of ₹Y at-risk, from running against a full batch (not one cherry-picked case)
2. **A moment where the system says no to itself** — an AI recommendation gets rejected or downgraded by your policy layer, live, in the demo
3. **A moment where the system stops safely** — a case that's hit its retry/contact limit and correctly gives up instead of nagging the customer forever
4. **A moment where a human is asked to approve** — a higher-risk action (e.g., a discount) pauses for merchant approval instead of firing automatically
5. **A full reasoning trace** — for any single case, you can show exactly what each agent decided and why, end to end

Everything in this spec is built to make those five things easy to demo.

---

## 3. Architecture

### 3.1 High-level flow

```
Failed payment / abandoned checkout event
                ↓
         Recovery Orchestrator  (deterministic, not an LLM — just app logic)
      ↙            ↓             ↘
Diagnosis      Customer &     [reads policy config]
 Agent         Value Agent
      \            ↓             /
         → Recovery Planner ←
                    ↓
          Policy Guard Agent   ← the most important agent; enforces hard limits
                    ↓
        ┌───────────┴───────────┐
   approved                 needs approval
        ↓                        ↓
  Action Executor      Merchant Approval Queue (dashboard)
        ↓                        ↓
  Razorpay Payment Link    (merchant clicks Approve/Reject)
  or Subscription Retry           ↓
        ↓                  Action Executor (if approved)
        └───────────┬───────────┘
                     ↓
              Audit Log Entry
                     ↓
              Dashboard + Recovery Metrics
```

### 3.2 The agents — final roster

| # | Agent | Type | Responsibility | Example structured output |
|---|---|---|---|---|
| 1 | **Recovery Orchestrator** | Deterministic code (not an LLM) | Receives the failed event, calls agents 2-5 in sequence, manages case status | N/A — this is your Express route/controller logic |
| 2 | **Diagnosis Agent** | LLM | Classifies *why* the payment/checkout failed | `{ "failure_class": "insufficient_funds", "confidence": 0.78, "reasoning": "..." }` |
| 3 | **Customer & Value Agent** | LLM | Assesses how much this case is worth recovering — cart/payment value, repeat-buyer status, attempt history | `{ "priority": "high", "cart_value": 3499, "is_repeat_buyer": true, "attempt_number": 1 }` |
| 4 | **Recovery Planner** | LLM | Given diagnosis + value context, recommends ONE action from a fixed allowed set | `{ "recommendation": "CREATE_PAYMENT_LINK", "reason": "...", "confidence": 0.82, "discount_requested_pct": 0 }` |
| 5 | **Policy Guard Agent** | Deterministic code (NOT an LLM — this is the critical design decision) | Validates the Planner's recommendation against hard business rules | `{ "decision": "APPROVED" \| "REJECTED_FALLBACK" \| "NEEDS_MERCHANT_APPROVAL" \| "BLOCKED_STOP_RULE", "reason": "...", "fallback_action": "..." }` |
| 6 | **Action Executor** | Deterministic code | Performs ONLY approved actions — calls Razorpay APIs or logs a simulated message | `{ "result": "success" \| "failure", "razorpay_reference": "plink_...", "timestamp": "..." }` |
| 7 | **Audit Logger** | Application service (not an agent, just a DB write) | Records every stage's input/output permanently | Full case document in MongoDB |

**Key design decision (this is what makes the project strong, don't skip it):** Only agents 2, 3, and 4 are actual LLM calls. Agents 1, 5, and 6 are **plain deterministic code** — no LLM involved. This is deliberate: an LLM should never be the thing that directly decides "yes, spend the money" — that's what the Policy Guard is for, and it must be boringly predictable, testable code, not a prompt. This is the single most important thing to get right and to explain clearly to judges.

### 3.3 What's AI vs. what's rules (don't blur this line)

**Use the LLM for (agents 2, 3, 4):**
- Explaining a likely failure cause in plain language
- Summarizing customer/order context into a priority judgment
- Recommending ONE action from a small fixed list of allowed actions
- Drafting the actual text of a recovery message (simulated, not really sent)
- Generating a merchant-readable explanation for the audit log

**Use fixed rules for (agent 5, Policy Guard):**
- Maximum retry attempts per case (e.g., 3)
- Maximum recovery-contact attempts per case (e.g., 2)
- Discount ceiling (e.g., never more than 5% without explicit merchant approval)
- Contact hours (don't "send" messages outside a defined window)
- Eligibility rules (e.g., don't attempt recovery on amounts below a minimum threshold — not worth the cost)
- Stop conditions (once retry/contact cap is hit, mark case as `stopped_safely`, don't touch it again)
- Approval thresholds (any action with `confidence < 0.6` OR `discount_requested_pct > 5` always routes to `NEEDS_MERCHANT_APPROVAL`)

### 3.4 Case status lifecycle (your MongoDB `status` field)

```
new → diagnosed → valued → planned → policy_checked →
   ├─ approved → executed → recovered | execution_failed
   ├─ needs_merchant_approval → (merchant acts) → approved/rejected → executed → ...
   └─ blocked_stop_rule → stopped_safely
```

---

## 4. Demo Script (build your data specifically to produce these 3 cases)

**Case A — Clean automated recovery**
₹2,499 UPI payment failed, first attempt, repeat buyer.
- Diagnosis: "Temporary UPI/bank failure, likely transient."
- Value: high priority (repeat buyer, first failure).
- Planner: "Create payment link after a short wait, no discount."
- Policy Guard: approved, no discount requested, first attempt — auto-approved.
- Executor: creates a real Razorpay test-mode Payment Link.
- Outcome: payment completes in test mode → dashboard shows "₹2,499 recovered."

**Case B — Safe stop**
₹5,000 order, third failed attempt.
- Diagnosis: "Repeated failures, likely a hard decline."
- Policy Guard: retry cap already reached → `BLOCKED_STOP_RULE`.
- Outcome: dashboard shows "Stopped safely — retry cap reached, customer protected from repeated contact," case flagged for manual review, NOT retried again.

**Case C — Human-gated escalation**
₹8,000 abandoned cart.
- Planner recommends a 5%+ discount to win it back.
- Policy Guard: discount exceeds auto-approve ceiling → `NEEDS_MERCHANT_APPROVAL`.
- Dashboard shows this case in a pending-approval queue.
- You click **Approve** live in the demo.
- Executor creates the payment link with the approved discount.
- Outcome: shows the human-in-the-loop gate working, live.

These three cases alone demonstrate all five things judges need to see (Section 2). Build your synthetic dataset so these three are guaranteed to occur, plus ~30-50 more varied cases to produce a real aggregate recovery-rate number.

---

## 5. Tech Stack

Sticking with what you already know well from CryptoGaze — no reason to introduce Next.js/Supabase when your existing stack does the job:

| Layer | Choice | Why |
|---|---|---|
| Frontend | React | You already know this from CryptoGaze |
| Backend | Node.js + Express | Same — reuse your API-proxy patterns |
| Database | MongoDB | Same — you already model TTL/cache data here; case documents fit naturally |
| AI (agents 2, 3, 4) | Anthropic API (Claude), structured JSON output | You've already integrated this in CryptoGaze's chat widget |
| Payments | Razorpay test-mode APIs — Payment Links API (primary), Subscriptions API (for mandate retries) | Payment Links API is simpler than raw Payments API and fits both the checkout and payment-failure cases well |
| Messaging | Simulated — just log "message sent" with drafted text, no real provider needed | Keeps scope tight; judges care about the decision/action loop, not real SMS delivery |

---

## 6. Data Model (MongoDB)

### `cases` collection — one document per failed payment/checkout
```json
{
  "_id": "ObjectId",
  "case_type": "failed_payment | failed_subscription | abandoned_checkout",
  "amount": 2499,
  "currency": "INR",
  "customer_id": "cust_001",
  "is_repeat_buyer": true,
  "attempt_number": 1,
  "failure_reason_raw": "BAD_REQUEST_ERROR: payment failed due to UPI issue",
  "created_at": "ISODate",
  "status": "new | diagnosed | valued | planned | policy_checked | approved | needs_merchant_approval | executed | recovered | execution_failed | blocked_stop_rule | stopped_safely",

  "diagnosis": {
    "failure_class": "insufficient_funds | expired_card | technical_decline | bank_error | checkout_abandoned",
    "confidence": 0.78,
    "reasoning": "..."
  },

  "value_assessment": {
    "priority": "high | medium | low",
    "cart_value": 2499,
    "is_repeat_buyer": true,
    "attempt_number": 1
  },

  "plan": {
    "recommendation": "CREATE_PAYMENT_LINK | RETRY_SUBSCRIPTION | SEND_REMINDER | OFFER_DISCOUNT | ESCALATE_TO_HUMAN | DO_NOT_CONTACT",
    "reasoning": "...",
    "confidence": 0.82,
    "discount_requested_pct": 0
  },

  "policy_check": {
    "decision": "APPROVED | REJECTED_FALLBACK | NEEDS_MERCHANT_APPROVAL | BLOCKED_STOP_RULE",
    "reason": "...",
    "fallback_action": "CREATE_PAYMENT_LINK_NO_DISCOUNT | null"
  },

  "merchant_approval": {
    "required": true,
    "approved_by_merchant": null,
    "approved_at": null
  },

  "execution": {
    "action_taken": "CREATE_PAYMENT_LINK",
    "result": "success | failure | not_attempted",
    "razorpay_reference": "plink_xxxxx",
    "timestamp": "ISODate"
  },

  "audit_log": [
    { "stage": "diagnosis", "timestamp": "ISODate", "output": { "...": "full diagnosis object" } },
    { "stage": "value_assessment", "timestamp": "ISODate", "output": { "...": "..." } },
    { "stage": "plan", "timestamp": "ISODate", "output": { "...": "..." } },
    { "stage": "policy_check", "timestamp": "ISODate", "output": { "...": "..." } },
    { "stage": "execution", "timestamp": "ISODate", "output": { "...": "..." } }
  ]
}
```

Storing the audit trail as an array of stage snapshots directly inside each case document makes the "reasoning trace" dashboard view trivial to build — you just render the array.

---

## 7. Where to Look for What (learning map)

| What you need to learn | Where to look | Why you need it |
|---|---|---|
| Razorpay Payment Links API (create, check status, test-mode) | Razorpay official developer docs — Payment Links section | This is your primary "money action" — used in Cases A and C |
| Razorpay Subscriptions/Mandates API | Razorpay official developer docs — Subscriptions section | Only needed if you include the failed-subscription case type; can be added after the core payment-link flow works |
| Razorpay test-mode setup (test API keys, test cards/UPI) | Razorpay dashboard → Test Mode section, plus their "Test Card/UPI" reference page | You need this before writing any integration code — set this up on Day 1 |
| Anthropic API structured/JSON output | Anthropic's API documentation on tool use / structured outputs | This is how agents 2, 3, 4 reliably return parseable JSON instead of free text |
| Express routing + async controllers | You already know this from CryptoGaze's backend proxy | Reused directly |
| MongoDB schema design for nested documents | You already know this from CryptoGaze's caching layer | The `audit_log` array pattern is new but simple — just `.push()` a new stage object as the case progresses |
| React state for a pending-approval queue + dashboard tables | You already know this from CryptoGaze's dashboard pages | Reused directly — this is standard list/detail view work |
| Designing policy/guardrail rules (the actual numbers: retry caps, discount ceilings, confidence thresholds) | This is a decision YOU make, not something to "look up" — write these down explicitly before coding the Policy Guard Agent | This is the most important design work in the whole project — don't skip planning it out on paper first |

---

## 8. Build Order (no strict timeline — just correct dependency order)

1. **Set up Razorpay test account**, get test API keys, understand Payment Links API by making one manual test call (e.g., via curl/Postman) before writing any app code.
2. **Reuse your CryptoGaze scaffolding**: repo structure, Express server, MongoDB connection, React app shell, Anthropic API client setup.
3. **Define your policy rules on paper first** — write down the actual numbers (max retries, discount ceiling, confidence threshold, minimum amount worth recovering) before writing the Policy Guard Agent's code. This is a business-logic decision, not a coding task.
4. **Build the `cases` MongoDB schema** and write a synthetic data generator that produces ~40-50 varied cases, deliberately including the three demo cases from Section 4.
5. **Build the Diagnosis Agent** — single LLM call, structured JSON output, test it against a handful of synthetic cases until the output is reliable.
6. **Build the Customer & Value Agent** — same pattern, second LLM call.
7. **Build the Recovery Planner** — third LLM call, takes outputs of the previous two agents as input.
8. **Build the Policy Guard Agent** — plain deterministic code, no LLM. This is where your Section 3.3 rules get implemented as `if` statements. Test it thoroughly against edge cases (discount too high, retry cap reached, low confidence).
9. **Build the Action Executor** — wire up the real Razorpay Payment Link creation call, gated so it only fires on `APPROVED` policy decisions.
10. **Build the Orchestrator** — the Express route/controller that runs a case through steps 5-9 in sequence, updating `status` at each stage, and pushing to `audit_log`.
11. **Build the merchant-approval queue** — a simple dashboard view listing cases with `status: needs_merchant_approval`, with Approve/Reject buttons that re-trigger the Executor.
12. **Build the main dashboard** — case list table, filters by status, summary card (total at-risk vs. recovered).
13. **Build the reasoning-trace detail view** — click into any case, render its `audit_log` array as a readable timeline.
14. **Run the full batch**, capture your real recovery-rate number, verify all three demo cases (Section 4) trigger correctly.
15. **Write your demo narration** around the three cases plus the aggregate number.

---

## 9. What Makes This Project Strong (keep these front and center)

- The Policy Guard Agent is deterministic code, not an LLM — this is your strongest, most defensible technical talking point. Lead with it in interviews and in the demo.
- Three scripted demo cases that each prove a different required behavior (auto-recovery, safe stop, human-gated escalation) rather than one vague end-to-end run.
- A full audit trail stored per-case, not just console logs — makes the "explainability" requirement tangible and inspectable live.
- Clear separation between "AI recommends" and "code decides" throughout the whole system — this is the single sentence that should anchor how you describe the architecture to anyone (judges, interviewers, teammates).
