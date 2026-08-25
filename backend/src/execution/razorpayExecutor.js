/**
 * razorpayExecutor.js — Real Razorpay test-mode Payment Links.
 *
 * Used for ONLY 2-3 hand-picked demo_case=true cases.
 * This is the ONLY file that converts rupees to paise.
 *
 * IMPORTANT: Never sets status="recovered" directly — only the
 * webhook handler (razorpayWebhook.js) can do that after
 * confirming a payment_link.paid event.
 */

const razorpay = require('../config/razorpayClient');

/**
 * Execute a recovery action via real Razorpay test-mode Payment Link.
 *
 * @param {object} caseData - The case document from MongoDB
 * @param {object} plan - The approved recovery plan
 * @returns {Promise<object>} Updated execution fields + status
 */
async function executeRazorpay(caseData, plan) {
  const now = new Date();
  const recommendation = plan.recommendation;

  // Only CREATE_PAYMENT_LINK and OFFER_DISCOUNT create real payment links
  if (recommendation === 'CREATE_PAYMENT_LINK' || recommendation === 'OFFER_DISCOUNT') {
    try {
      let finalAmount = caseData.amount;

      // Apply discount if this is an approved OFFER_DISCOUNT action
      if (recommendation === 'OFFER_DISCOUNT' && plan.discount_requested_pct > 0) {
        const discountMultiplier = 1 - (plan.discount_requested_pct / 100);
        finalAmount = Math.round(caseData.amount * discountMultiplier);
      }

      // ──────────────────────────────────────────────────────────────
      // AMOUNT CONVENTION: amounts are stored in whole rupees everywhere.
      // Razorpay's API requires paise (subunits). Convert ONLY here:
      const amountInPaise = finalAmount * 100;
      // ──────────────────────────────────────────────────────────────

      const paymentLink = await razorpay.paymentLink.create({
        amount: amountInPaise,
        currency: caseData.currency || 'INR',
        description: `RevivePay Recovery - Case ${caseData._id}`,
        customer: {
          name: `Customer ${caseData.customer_id}`,
          contact: '+919876543210' // Must not have recurring digits for Razorpay test-mode
        },
        notify: {
          sms: false,
          email: false
        },
        reminder_enable: false,
        notes: {
          case_id: caseData._id.toString(),
          original_amount: caseData.amount,
          discount_pct: plan.discount_requested_pct || 0,
          source: 'revivepay'
        }
      });

      return {
        execution: {
          executor_type: 'razorpay',
          action_taken: recommendation,
          result: 'success',
          razorpay_reference: paymentLink.id,
          payment_link_status: 'created',
          timestamp: now
        },
        // NEVER set "recovered" here — only the webhook can do that
        status: 'awaiting_payment',
        contact_count: caseData.contact_count + 1,
        last_contacted_at: now,
        payment_link_url: paymentLink.short_url
      };
    } catch (error) {
      console.error(`[RazorpayExecutor] Error creating payment link for case ${caseData._id}:`, error.error?.description || error.message || error);
      return {
        execution: {
          executor_type: 'razorpay',
          action_taken: recommendation,
          result: 'failure',
          razorpay_reference: null,
          payment_link_status: null,
          timestamp: now
        },
        status: 'execution_failed'
      };
    }
  }

  // SEND_REMINDER — simulate (no real messaging provider)
  if (recommendation === 'SEND_REMINDER') {
    console.log(`[RazorpayExecutor] Simulated reminder for case ${caseData._id}`);
    return {
      execution: {
        executor_type: 'razorpay',
        action_taken: 'SEND_REMINDER',
        result: 'success',
        razorpay_reference: null,
        payment_link_status: null,
        timestamp: now
      },
      status: 'link_created',
      contact_count: caseData.contact_count + 1,
      last_contacted_at: now
    };
  }

  // ESCALATE_TO_HUMAN / DO_NOT_CONTACT — no external call
  return {
    execution: {
      executor_type: 'razorpay',
      action_taken: recommendation,
      result: 'not_attempted',
      razorpay_reference: null,
      payment_link_status: null,
      timestamp: now
    },
    status: recommendation === 'DO_NOT_CONTACT' ? 'stopped_safely' : 'needs_merchant_approval'
  };
}

module.exports = { executeRazorpay };
