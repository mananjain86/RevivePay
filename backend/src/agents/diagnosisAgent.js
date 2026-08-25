/**
 * diagnosisAgent.js — Classifies why a payment/checkout failed.
 *
 * LLM Agent #1 of 3. Uses Gemini structured JSON output.
 * On failure: falls back to safe defaults, never crashes.
 */

const { callGemini, SchemaType } = require('../config/geminiClient');

const VALID_FAILURE_CLASSES = [
  'insufficient_funds', 'expired_card', 'technical_decline',
  'bank_error', 'checkout_abandoned', 'unknown'
];

const DIAGNOSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    failure_class: {
      type: SchemaType.STRING,
      description: 'The classified cause of the payment failure. Must be one of: insufficient_funds, expired_card, technical_decline, bank_error, checkout_abandoned, unknown',
      enum: VALID_FAILURE_CLASSES
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'Confidence score from 0.0 to 1.0 inclusive'
    },
    reasoning: {
      type: SchemaType.STRING,
      description: 'Brief 1-2 sentence explanation of the diagnosis'
    }
  },
  required: ['failure_class', 'confidence', 'reasoning']
};

const SYSTEM_PROMPT = `You are a payment failure diagnosis specialist for an Indian e-commerce platform.
Your job is to analyze a failed payment or abandoned checkout and classify the root cause.

You will be given:
- case_type: either "failed_payment" or "abandoned_checkout"
- failure_reason_raw: the raw error message or abandonment context
- attempt_number: how many times this payment has been attempted

Classify the failure into exactly one of these categories:
- insufficient_funds: customer's account/card has insufficient balance
- expired_card: the payment card has expired
- technical_decline: a temporary technical issue (UPI timeout, gateway error, 3DS failure)
- bank_error: the issuing bank declined for non-card-expiry reasons (blocked card, daily limit, server down)
- checkout_abandoned: customer left the checkout flow voluntarily (not a payment error)
- unknown: cannot determine the cause with reasonable confidence

Be precise with your confidence score. High confidence (0.8+) only when the raw reason clearly maps to one category. Lower confidence when the reason is ambiguous.`;

/**
 * Diagnose why a payment/checkout failed.
 *
 * @param {object} caseData - The case document from MongoDB
 * @returns {Promise<object>} { failure_class, confidence, reasoning }
 */
async function diagnoseCase(caseData) {
  const userPrompt = `Diagnose this case:
- Case type: ${caseData.case_type}
- Failure reason: ${caseData.failure_reason_raw || 'No reason provided'}
- Attempt number: ${caseData.attempt_number}`;

  try {
    const result = await callGemini({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema: DIAGNOSIS_SCHEMA,
      agentName: 'diagnosis'
    });

    // Code-side validation (second layer of defense after Gemini's responseSchema)
    return validateDiagnosis(result);
  } catch (error) {
    console.error(`[DiagnosisAgent] Error for case ${caseData._id}: ${error.message}`);
    // Return safe fallback — never crash
    return {
      failure_class: 'unknown',
      confidence: 0,
      reasoning: 'agent_error_fallback'
    };
  }
}

/**
 * Validate and sanitize the LLM's diagnosis output.
 */
function validateDiagnosis(result) {
  let { failure_class, confidence, reasoning } = result || {};

  // failure_class must be one of 6 exact values (case-sensitive)
  if (!VALID_FAILURE_CLASSES.includes(failure_class)) {
    failure_class = 'unknown';
  }

  // confidence must be a number between 0 and 1
  if (typeof confidence !== 'number' || isNaN(confidence)) {
    confidence = 0;
  }
  confidence = Math.max(0, Math.min(1, confidence));

  // reasoning must be a string
  if (typeof reasoning !== 'string' || !reasoning) {
    reasoning = 'No reasoning provided';
  }

  return { failure_class, confidence, reasoning };
}

module.exports = { diagnoseCase };
