/**
 * valueAgent.js — Assesses how much a failed case is worth recovering.
 *
 * LLM Agent #2 of 3. Uses Gemini structured JSON output.
 * The agent's job is to judge priority — for echoed fields (cart_value,
 * is_repeat_buyer, attempt_number), we always trust caseData over the agent.
 */

const { callGemini, SchemaType } = require('../config/geminiClient');

const VALID_PRIORITIES = ['high', 'medium', 'low'];

const VALUE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    priority: {
      type: SchemaType.STRING,
      description: 'Recovery priority: high, medium, or low',
      enum: VALID_PRIORITIES
    },
    cart_value: {
      type: SchemaType.NUMBER,
      description: 'The order/cart value in rupees (should match the provided amount)'
    },
    is_repeat_buyer: {
      type: SchemaType.BOOLEAN,
      description: 'Whether this is a repeat customer (should match provided data)'
    },
    attempt_number: {
      type: SchemaType.NUMBER,
      description: 'Current attempt number (should match provided data)'
    }
  },
  required: ['priority', 'cart_value', 'is_repeat_buyer', 'attempt_number']
};

const SYSTEM_PROMPT = `You are a customer value assessment specialist for an Indian e-commerce platform's revenue recovery team.

Your job is to assess the PRIORITY of recovering a failed payment or abandoned checkout.

Consider these factors when judging priority:
- Higher amounts deserve higher priority (₹5000+ is high, ₹1000-5000 is medium, below ₹1000 is low — but adjust based on other factors)
- Repeat buyers are more valuable — recovering them preserves long-term revenue
- First attempts are more likely to succeed than third attempts
- Abandoned checkouts from repeat buyers on high-value items are very high priority

Rate as:
- "high": Significant revenue at risk, good chance of recovery, or important customer to retain
- "medium": Moderate revenue, reasonable recovery chance
- "low": Small amount, unlikely to succeed, or low customer value

Also echo back the cart_value, is_repeat_buyer, and attempt_number from the input data as a sanity check.`;

/**
 * Assess the recovery value and priority of a case.
 *
 * @param {object} caseData - The case document from MongoDB
 * @returns {Promise<object>} { priority, cart_value, is_repeat_buyer, attempt_number }
 */
async function assessValue(caseData) {
  const userPrompt = `Assess the recovery priority for this case:
- Case type: ${caseData.case_type}
- Amount: ₹${caseData.amount}
- Is repeat buyer: ${caseData.is_repeat_buyer}
- Attempt number: ${caseData.attempt_number}`;

  try {
    const result = await callGemini({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      responseSchema: VALUE_SCHEMA
    });

    return validateValueAssessment(result, caseData);
  } catch (error) {
    console.error(`[ValueAgent] Error for case ${caseData._id}: ${error.message}`);
    // Safe fallback — default to low priority, trust caseData for facts
    return {
      priority: 'low',
      cart_value: caseData.amount,
      is_repeat_buyer: caseData.is_repeat_buyer,
      attempt_number: caseData.attempt_number
    };
  }
}

/**
 * Validate the LLM's value assessment output.
 * For echoed fields, always trust caseData over the agent.
 */
function validateValueAssessment(result, caseData) {
  let { priority } = result || {};

  // priority must be one of 3 values
  if (!VALID_PRIORITIES.includes(priority)) {
    priority = 'low';
  }

  // Always trust original caseData for factual fields, not the agent's echo
  return {
    priority,
    cart_value: caseData.amount,
    is_repeat_buyer: caseData.is_repeat_buyer,
    attempt_number: caseData.attempt_number
  };
}

module.exports = { assessValue };
