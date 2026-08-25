/**
 * plannerAgent.js — Recommends ONE recovery action from a fixed allowed set.
 *
 * LLM Agent #3 of 3. Uses Gemini structured JSON output.
 * The agent may only choose from exactly 5 actions — never invent a new one.
 */

const { callGemini, SchemaType } = require('../config/geminiClient');

const VALID_RECOMMENDATIONS = [
  'CREATE_PAYMENT_LINK', 'SEND_REMINDER', 'OFFER_DISCOUNT',
  'ESCALATE_TO_HUMAN', 'DO_NOT_CONTACT'
];

const PLANNER_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    recommendation: {
      type: SchemaType.STRING,
      description: 'The recommended recovery action. Must be exactly one of: CREATE_PAYMENT_LINK, SEND_REMINDER, OFFER_DISCOUNT, ESCALATE_TO_HUMAN, DO_NOT_CONTACT',
      enum: VALID_RECOMMENDATIONS
    },
    reasoning: {
      type: SchemaType.STRING,
      description: 'Brief 1-2 sentence explanation of why this action was chosen'
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'Confidence score from 0.0 to 1.0 inclusive'
    },
    discount_requested_pct: {
      type: SchemaType.NUMBER,
      description: 'Discount percentage (0-100). Should be 0 unless recommendation is OFFER_DISCOUNT'
    }
  },
  required: ['recommendation', 'reasoning', 'confidence', 'discount_requested_pct']
};

const SYSTEM_PROMPT = `You are a recovery action planner for an Indian e-commerce platform's AI revenue recovery system.

Given the diagnosis (why a payment failed) and the value assessment (how important this case is), recommend ONE recovery action.

You may ONLY choose from these exact 5 actions — never invent a sixth:

1. CREATE_PAYMENT_LINK — Generate a fresh Razorpay payment link for the customer. Best for transient failures, first attempts, or when a simple retry is likely to work.
2. SEND_REMINDER — Send a reminder message to the customer. Best for abandoned checkouts or when waiting before a payment link makes sense.
3. OFFER_DISCOUNT — Offer a percentage discount to incentivize completion. ONLY use this for high-value cases where the customer needs a nudge (e.g., abandoned cart with hesitation). Specify the discount_requested_pct (1-10 range typically).
4. ESCALATE_TO_HUMAN — Route this case to a human agent for manual review. Use when the situation is complex, ambiguous, or when you have low confidence.
5. DO_NOT_CONTACT — Do not attempt recovery. Use ONLY for cases where contact would be inappropriate (e.g., clear fraud signals, customer explicitly cancelled).

Guidelines:
- For first-attempt transient failures with high value: CREATE_PAYMENT_LINK (high confidence)
- For abandoned checkouts from repeat buyers with high cart value: consider OFFER_DISCOUNT with a small percentage (3-5%)
- For repeated failures (attempt >= 2): be more cautious, lower confidence
- For unknown/ambiguous failures: ESCALATE_TO_HUMAN
- Never recommend DO_NOT_CONTACT unless there's a strong reason — it discards a possibly-recoverable case
- Set discount_requested_pct to 0 unless recommending OFFER_DISCOUNT`;

/**
 * Plan a recovery action for a case.
 *
 * @param {object} caseData - The case document from MongoDB
 * @param {object} diagnosis - Output from diagnosisAgent
 * @param {object} valueAssessment - Output from valueAgent
 * @returns {Promise<object>} { recommendation, reasoning, confidence, discount_requested_pct }
 */
async function planRecovery(caseData, diagnosis, valueAssessment) {
  const userPrompt = `Plan the recovery action for this case:

Case details:
- Type: ${caseData.case_type}
- Amount: ₹${caseData.amount}
- Attempt: ${caseData.attempt_number}
- Repeat buyer: ${caseData.is_repeat_buyer}
- Raw failure: ${caseData.failure_reason_raw || 'N/A'}

Diagnosis:
- Failure class: ${diagnosis.failure_class}
- Confidence: ${diagnosis.confidence}
- Reasoning: ${diagnosis.reasoning}

Value Assessment:
- Priority: ${valueAssessment.priority}
- Cart value: ₹${valueAssessment.cart_value}`;

  try {
    const result = await callGemini({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema: PLANNER_SCHEMA
    });

    return validatePlan(result);
  } catch (error) {
    console.error(`[PlannerAgent] Error for case ${caseData._id}: ${error.message}`);
    // Safe fallback — ESCALATE_TO_HUMAN with confidence 0
    // Policy Guard rule 6 will naturally route to NEEDS_MERCHANT_APPROVAL
    return {
      recommendation: 'ESCALATE_TO_HUMAN',
      reasoning: 'agent_error_fallback',
      confidence: 0,
      discount_requested_pct: 0
    };
  }
}

/**
 * Validate and sanitize the LLM's recovery plan output.
 */
function validatePlan(result) {
  let { recommendation, reasoning, confidence, discount_requested_pct } = result || {};

  // recommendation must be one of 5 exact values
  // If not, force to ESCALATE_TO_HUMAN (safest fallback)
  // Never silently drop to DO_NOT_CONTACT — that discards a possibly-recoverable case
  if (!VALID_RECOMMENDATIONS.includes(recommendation)) {
    recommendation = 'ESCALATE_TO_HUMAN';
  }

  // confidence clamped to [0, 1]
  if (typeof confidence !== 'number' || isNaN(confidence)) {
    confidence = 0;
  }
  confidence = Math.max(0, Math.min(1, confidence));

  // discount_requested_pct clamped to [0, 100]
  if (typeof discount_requested_pct !== 'number' || isNaN(discount_requested_pct)) {
    discount_requested_pct = 0;
  }
  discount_requested_pct = Math.max(0, Math.min(100, discount_requested_pct));

  // If recommendation is not OFFER_DISCOUNT, force discount to 0
  if (recommendation !== 'OFFER_DISCOUNT') {
    discount_requested_pct = 0;
  }

  // reasoning must be a string
  if (typeof reasoning !== 'string' || !reasoning) {
    reasoning = 'No reasoning provided';
  }

  return { recommendation, reasoning, confidence, discount_requested_pct };
}

module.exports = { planRecovery };
