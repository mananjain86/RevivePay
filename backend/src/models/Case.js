const mongoose = require('mongoose');

const caseSchema = new mongoose.Schema({
  case_type: {
    type: String,
    enum: ['failed_payment', 'abandoned_checkout'],
    required: true
  },

  // ALWAYS whole rupees, never paise — paise conversion happens ONLY in razorpayExecutor.js
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  customer_id: { type: String, required: true },
  is_repeat_buyer: { type: Boolean, default: false },
  attempt_number: { type: Number, default: 1 },
  failure_reason_raw: { type: String },
  created_at: { type: Date, default: Date.now },

  // --- Consent / compliance fields ---
  // Default false (safety-first) — synthetic data generator must explicitly opt cases in
  has_recovery_consent: { type: Boolean, default: false },
  contact_count: { type: Number, default: 0 },
  last_contacted_at: { type: Date, default: null },
  max_contact_count: { type: Number, default: 2 },

  status: {
    type: String,
    enum: [
      'new',
      'processing',                // atomic claim status
      'diagnosed',
      'valued',
      'planned',
      'policy_checked',
      'approved',
      'needs_merchant_approval',
      'link_created',
      'awaiting_payment',
      'recovered',
      'unrecovered_expired',       // customer didn't pay — distinct from execution_failed
      'execution_failed',          // reserved for actual API/network/executor errors
      'blocked_stop_rule',
      'stopped_safely',
      'blocked_no_consent'
    ],
    default: 'new'
  },

  diagnosis: {
    failure_class: {
      type: String,
      enum: ['insufficient_funds', 'expired_card', 'technical_decline', 'bank_error', 'checkout_abandoned', 'unknown']
    },
    confidence: { type: Number, min: 0, max: 1 },
    reasoning: String
  },

  value_assessment: {
    priority: { type: String, enum: ['high', 'medium', 'low'] },
    cart_value: Number,
    is_repeat_buyer: Boolean,
    attempt_number: Number
  },

  plan: {
    recommendation: {
      type: String,
      enum: ['CREATE_PAYMENT_LINK', 'SEND_REMINDER', 'OFFER_DISCOUNT', 'ESCALATE_TO_HUMAN', 'DO_NOT_CONTACT']
    },
    reasoning: String,
    confidence: { type: Number, min: 0, max: 1 },
    discount_requested_pct: { type: Number, default: 0, min: 0, max: 100 }
  },

  policy_check: {
    decision: {
      type: String,
      enum: ['APPROVED', 'REJECTED_FALLBACK', 'NEEDS_MERCHANT_APPROVAL', 'BLOCKED_STOP_RULE', 'BLOCKED_NO_CONSENT']
    },
    reason: String,
    fallback_action: String
  },

  // Result of re-checking policy on the fallback plan (v3 addition)
  fallback_policy_check: {
    decision: {
      type: String,
      enum: ['APPROVED', 'NEEDS_MERCHANT_APPROVAL', 'BLOCKED_STOP_RULE']
    },
    reason: String
  },

  merchant_approval: {
    required: { type: Boolean, default: false },
    approved_by_merchant: { type: Boolean, default: null },
    approved_at: Date
  },

  execution: {
    executor_type: { type: String, enum: ['simulated', 'razorpay'], default: 'simulated' },
    action_taken: String,
    result: { type: String, enum: ['success', 'failure', 'not_attempted'], default: 'not_attempted' },
    razorpay_reference: String,
    payment_link_status: { type: String, enum: ['created', 'paid', 'expired', 'cancelled', null], default: null },
    timestamp: Date,
    // Records which agent(s) fell back due to Gemini failure
    agent_errors: [String]
  },

  demo_case: { type: Boolean, default: false },

  audit_log: [
    {
      stage: String,
      timestamp: { type: Date, default: Date.now },
      output: mongoose.Schema.Types.Mixed
    }
  ]
}, {
  timestamps: true
});

module.exports = mongoose.model('Case', caseSchema);
