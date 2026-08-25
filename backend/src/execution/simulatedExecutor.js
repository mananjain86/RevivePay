/**
 * simulatedExecutor.js — Handles execution for the full batch (40-100 cases).
 *
 * Never calls the real Razorpay API. Uses seeded PRNG for deterministic,
 * reproducible outcomes — the same case always resolves the same way.
 * ~65% of payment links resolve to "paid", remainder unresolved/expired.
 */

const { createSeededRng } = require('../utils/seededRandom');

/**
 * Execute a recovery action in simulation mode.
 *
 * @param {object} caseData - The case document from MongoDB
 * @param {object} plan - The approved recovery plan
 * @returns {object} Updated execution fields + status to set on the case
 */
function executeSimulated(caseData, plan) {
  const rng = createSeededRng(caseData._id.toString());
  const now = new Date();
  const recommendation = plan.recommendation;

  // Actions that involve a payment link
  if (recommendation === 'CREATE_PAYMENT_LINK' || recommendation === 'OFFER_DISCOUNT') {
    const simReference = `sim_plink_${caseData._id.toString().slice(-8)}`;
    const paymentOutcome = rng(); // deterministic [0, 1)

    let paymentLinkStatus;
    let status;

    if (paymentOutcome < 0.65) {
      // ~65% chance: customer pays
      paymentLinkStatus = 'paid';
      status = 'recovered';
    } else if (paymentOutcome < 0.85) {
      // ~20% chance: link expires (customer didn't pay)
      paymentLinkStatus = 'expired';
      status = 'unrecovered_expired';
    } else {
      // ~15% chance: still outstanding
      paymentLinkStatus = 'created';
      status = 'link_created';
    }

    return {
      execution: {
        executor_type: 'simulated',
        action_taken: recommendation,
        result: 'success',
        razorpay_reference: simReference,
        payment_link_status: paymentLinkStatus,
        timestamp: now
      },
      status,
      // Increment contact_count for payment link actions
      contact_count: caseData.contact_count + 1,
      last_contacted_at: now
    };
  }

  // SEND_REMINDER — simulate message sent
  if (recommendation === 'SEND_REMINDER') {
    return {
      execution: {
        executor_type: 'simulated',
        action_taken: 'SEND_REMINDER',
        result: 'success',
        razorpay_reference: null,
        payment_link_status: null,
        timestamp: now
      },
      status: 'link_created', // reminder sent, waiting for customer action
      contact_count: caseData.contact_count + 1,
      last_contacted_at: now
    };
  }

  // ESCALATE_TO_HUMAN / DO_NOT_CONTACT — no external action
  return {
    execution: {
      executor_type: 'simulated',
      action_taken: recommendation,
      result: 'not_attempted',
      razorpay_reference: null,
      payment_link_status: null,
      timestamp: now
    },
    status: recommendation === 'DO_NOT_CONTACT' ? 'stopped_safely' : 'needs_merchant_approval'
  };
}

module.exports = { executeSimulated };
