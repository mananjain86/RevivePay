/**
 * generateSyntheticData.js — Seeds 50 varied cases into MongoDB.
 *
 * Includes the 3 guaranteed demo cases plus ~47 varied cases with
 * realistic variation across case_type, amount, attempt_number,
 * is_repeat_buyer, has_recovery_consent, and contact_count.
 *
 * IMPORTANT: has_recovery_consent defaults to false in the schema,
 * so we must explicitly set true on most records or nothing will process.
 *
 * Usage: node src/data/generateSyntheticData.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Case = require('../models/Case');

// ─── The 3 guaranteed demo cases ──────────────────────────────────

const demoCases = [
  // Case A — Clean auto-recovery: ₹2,499 UPI, attempt 1, repeat buyer
  {
    case_type: 'failed_payment',
    amount: 2499,
    customer_id: 'demo-case-a',
    is_repeat_buyer: true,
    attempt_number: 1,
    failure_reason_raw: 'UPI payment failed - bank timeout',
    has_recovery_consent: true,
    contact_count: 0,
    max_contact_count: 2,
    demo_case: true,
    status: 'new'
  },
  // Case B — Safe stop: ₹5,000, attempt 3 (will hit BLOCKED_STOP_RULE)
  {
    case_type: 'failed_payment',
    amount: 5000,
    customer_id: 'demo-case-b',
    is_repeat_buyer: false,
    attempt_number: 3,
    failure_reason_raw: 'Card declined - repeated failures',
    has_recovery_consent: true,
    contact_count: 1,
    max_contact_count: 2,
    demo_case: true,
    status: 'new'
  },
  // Case C — Human-gated discount: ₹8,000 abandoned cart
  {
    case_type: 'abandoned_checkout',
    amount: 8000,
    customer_id: 'demo-case-c',
    is_repeat_buyer: true,
    attempt_number: 1,
    failure_reason_raw: 'Cart abandoned at payment step, high value item - customer hesitated after seeing total',
    has_recovery_consent: true,
    contact_count: 0,
    max_contact_count: 2,
    demo_case: true,
    status: 'new'
  }
];

// ─── Variation pools for random generation ────────────────────────

const caseTypes = ['failed_payment', 'abandoned_checkout'];

const failureReasons = {
  failed_payment: [
    'BAD_REQUEST_ERROR: payment failed due to UPI issue',
    'Card declined by issuing bank',
    'Insufficient funds in account',
    'Card expired - payment rejected',
    'Payment gateway timeout - bank did not respond',
    'UPI VPA not found',
    'Transaction declined by bank',
    'Network error during payment processing',
    'Card blocked for online transactions',
    'Payment authentication failed - 3DS timeout',
    'Bank server down - try again later',
    'Daily transaction limit exceeded',
    'International card not accepted',
    'Payment session expired before completion'
  ],
  abandoned_checkout: [
    'Cart abandoned at payment step',
    'Customer left during address entry',
    'Abandoned after viewing order summary',
    'Cart abandoned - price comparison likely',
    'Checkout abandoned after coupon code failed',
    'Left at shipping options page',
    'Abandoned during payment method selection',
    'Cart timeout - session expired',
    'Customer abandoned after seeing shipping cost',
    'Checkout abandoned at final confirmation'
  ]
};

const amounts = [
  149, 299, 499, 599, 799, 999, 1199, 1499, 1799, 1999,
  2199, 2499, 2999, 3499, 3999, 4499, 4999, 5499, 5999,
  6499, 6999, 7499, 7999, 8999, 9999, 11999, 14999, 19999
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomCase(index) {
  const caseType = randomItem(caseTypes);
  const amount = randomItem(amounts);
  const attemptNumber = randomInt(1, 4); // some will be >= 3 to trigger stop rules
  const isRepeatBuyer = Math.random() > 0.4;

  // Most cases have consent (true), but a few deliberately don't
  let hasRecoveryConsent = true;
  if (index % 12 === 0) {
    // ~4 out of 47 cases will lack consent
    hasRecoveryConsent = false;
  }

  // A few cases already at contact cap to demonstrate stop rule independent of attempt_number
  let contactCount = 0;
  let maxContactCount = 2;
  if (index % 15 === 0 && attemptNumber < 3) {
    contactCount = 2; // already at cap
    maxContactCount = 2;
  }

  // Some sub-₹100 amounts to trigger minimum recovery threshold
  const finalAmount = (index % 20 === 0) ? randomInt(30, 90) : amount;

  return {
    case_type: caseType,
    amount: finalAmount,
    customer_id: `cust_${String(index + 100).padStart(4, '0')}`,
    is_repeat_buyer: isRepeatBuyer,
    attempt_number: attemptNumber,
    failure_reason_raw: randomItem(failureReasons[caseType]),
    has_recovery_consent: hasRecoveryConsent,
    contact_count: contactCount,
    max_contact_count: maxContactCount,
    demo_case: false,
    status: 'new'
  };
}

// ─── Main seeding function ────────────────────────────────────────

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[Seed] Connected to MongoDB');

    // Clear existing cases
    await Case.deleteMany({});
    console.log('[Seed] Cleared existing cases');

    // Generate random cases
    const randomCases = [];
    for (let i = 0; i < 47; i++) {
      randomCases.push(generateRandomCase(i));
    }

    // Combine demo + random cases
    const allCases = [...demoCases, ...randomCases];

    // Insert all
    const inserted = await Case.insertMany(allCases);
    console.log(`[Seed] Inserted ${inserted.length} cases`);

    // Summary
    const consentFalse = allCases.filter(c => !c.has_recovery_consent).length;
    const highAttempt = allCases.filter(c => c.attempt_number >= 3).length;
    const atContactCap = allCases.filter(c => c.contact_count >= c.max_contact_count).length;
    const lowAmount = allCases.filter(c => c.amount < 100).length;
    const demos = allCases.filter(c => c.demo_case).length;

    console.log(`[Seed] Summary:`);
    console.log(`  Total: ${allCases.length}`);
    console.log(`  Demo cases: ${demos}`);
    console.log(`  No consent: ${consentFalse} (will be blocked)`);
    console.log(`  High attempt (>=3): ${highAttempt} (will trigger stop rule)`);
    console.log(`  At contact cap: ${atContactCap} (will trigger stop rule)`);
    console.log(`  Below ₹100: ${lowAmount} (will trigger minimum threshold)`);

    await mongoose.disconnect();
    console.log('[Seed] Done');
  } catch (error) {
    console.error('[Seed] Error:', error);
    process.exit(1);
  }
}

seedData();
