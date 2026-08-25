/**
 * policyGuard.js — Deterministic policy enforcement.
 *
 * CRITICAL: This file contains ZERO LLM calls. Pure deterministic logic.
 * This is the most important design decision in the entire project:
 * an LLM should never be the thing that directly decides "yes, spend the money."
 *
 * Rules are applied in a specific order (order matters — first match wins).
 */

// ─── Named policy constants (easy to find and adjust) ─────────────
const MAX_ATTEMPTS = 3;
const MIN_RECOVERABLE_AMOUNT = 100; // rupees
const AUTO_APPROVE_DISCOUNT_MAX_PCT = 0; // 0% = no discount can auto-approve
const APPROVAL_DISCOUNT_MAX_PCT = 5;     // 1-5% needs merchant approval
const MIN_CONFIDENCE_AUTO_APPROVE = 0.6;

/**
 * Check whether a recovery plan passes the policy rules.
 *
 * Discount tiers:
 *   0%  → can auto-approve (if confidence is high enough)
 *   1-5% → needs merchant approval
 *   >5% → rejected outright, automatic no-discount fallback
 *
 * @param {object} caseData - The case document from MongoDB
 * @param {object} plan - The recovery plan from the Planner Agent
 * @returns {object} { decision, reason, fallback_action? }
 */
function checkPolicy(caseData, plan) {
  // Rule 1: Consent check (safety-first)
  if (caseData.has_recovery_consent === false) {
    return {
      decision: 'BLOCKED_NO_CONSENT',
      reason: 'Customer has not consented to recovery contact'
    };
  }

  // Rule 2: Retry/contact cap check (protects customer from repeated contact)
  if (caseData.attempt_number >= MAX_ATTEMPTS || caseData.contact_count >= caseData.max_contact_count) {
    return {
      decision: 'BLOCKED_STOP_RULE',
      reason: `Retry/contact cap reached (attempt ${caseData.attempt_number}/${MAX_ATTEMPTS}, contacts ${caseData.contact_count}/${caseData.max_contact_count})`
    };
  }

  // Rule 3: Minimum amount threshold (not worth the cost)
  if (caseData.amount < MIN_RECOVERABLE_AMOUNT) {
    return {
      decision: 'BLOCKED_STOP_RULE',
      reason: `Amount ₹${caseData.amount} below minimum recovery threshold (₹${MIN_RECOVERABLE_AMOUNT})`
    };
  }

  // Rule 4: Discount exceeds hard ceiling → REJECTED with automatic fallback
  if (plan.discount_requested_pct > APPROVAL_DISCOUNT_MAX_PCT) {
    return {
      decision: 'REJECTED_FALLBACK',
      reason: `Discount ${plan.discount_requested_pct}% exceeds maximum allowable ceiling (${APPROVAL_DISCOUNT_MAX_PCT}%)`,
      fallback_action: 'CREATE_PAYMENT_LINK'
    };
  }

  // Rule 5: Any discount (1-5%) requires merchant approval
  if (plan.discount_requested_pct > AUTO_APPROVE_DISCOUNT_MAX_PCT &&
      plan.discount_requested_pct <= APPROVAL_DISCOUNT_MAX_PCT) {
    return {
      decision: 'NEEDS_MERCHANT_APPROVAL',
      reason: `Any discount (${plan.discount_requested_pct}%, range 1-${APPROVAL_DISCOUNT_MAX_PCT}%) requires merchant approval`
    };
  }

  // Rule 6: Low confidence requires merchant review
  if (plan.confidence < MIN_CONFIDENCE_AUTO_APPROVE) {
    return {
      decision: 'NEEDS_MERCHANT_APPROVAL',
      reason: `Planner confidence ${plan.confidence.toFixed(2)} below auto-approve threshold (${MIN_CONFIDENCE_AUTO_APPROVE})`
    };
  }

  // Rule 7: All checks passed
  return {
    decision: 'APPROVED',
    reason: 'Within policy limits'
  };
}

module.exports = {
  checkPolicy,
  // Export constants for testing and reference
  POLICY_CONSTANTS: {
    MAX_ATTEMPTS,
    MIN_RECOVERABLE_AMOUNT,
    AUTO_APPROVE_DISCOUNT_MAX_PCT,
    APPROVAL_DISCOUNT_MAX_PCT,
    MIN_CONFIDENCE_AUTO_APPROVE
  }
};
