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

// ─── Highly diverse curated test cases (Total 6) ──────────────────────────────────

const allCases = [
  // 1. Demo Case A — Clean auto-recovery: ₹2,499 UPI, attempt 1 (Razorpay Execution)
  {
    case_type: 'failed_payment', amount: 2499, customer_id: 'demo-clean',
    is_repeat_buyer: true, attempt_number: 1, failure_reason_raw: 'UPI payment failed - bank timeout',
    has_recovery_consent: true, contact_count: 0, max_contact_count: 2, demo_case: true, status: 'new'
  },
  // 2. Demo Case B — Safe stop: ₹5,000, attempt 3 (Will hit BLOCKED_STOP_RULE)
  {
    case_type: 'failed_payment', amount: 5000, customer_id: 'demo-stop',
    is_repeat_buyer: false, attempt_number: 3, failure_reason_raw: 'Card declined - repeated failures',
    has_recovery_consent: true, contact_count: 1, max_contact_count: 2, demo_case: true, status: 'new'
  },
  // 3. Demo Case C — Human-gated discount: ₹8,000 abandoned cart (Needs merchant approval)
  {
    case_type: 'abandoned_checkout', amount: 8000, customer_id: 'demo-human',
    is_repeat_buyer: true, attempt_number: 1, failure_reason_raw: 'Cart abandoned at payment step, high value item',
    has_recovery_consent: true, contact_count: 0, max_contact_count: 2, demo_case: true, status: 'new'
  },
  // 4. Edge Case — No consent (Will be blocked immediately by PolicyGuard)
  {
    case_type: 'failed_payment', amount: 1200, customer_id: 'edge-no-consent',
    is_repeat_buyer: false, attempt_number: 1, failure_reason_raw: 'Insufficient funds',
    has_recovery_consent: false, contact_count: 0, max_contact_count: 2, demo_case: false, status: 'new'
  },
  // 5. Edge Case — Minimum threshold (Amount too low, will be stopped)
  {
    case_type: 'abandoned_checkout', amount: 45, customer_id: 'edge-low-value',
    is_repeat_buyer: true, attempt_number: 1, failure_reason_raw: 'Abandoned checkout',
    has_recovery_consent: true, contact_count: 0, max_contact_count: 2, demo_case: false, status: 'new'
  },
  // 6. Edge Case — Simulated Reminder (Standard AI handling)
  {
    case_type: 'failed_payment', amount: 800, customer_id: 'edge-reminder',
    is_repeat_buyer: false, attempt_number: 1, failure_reason_raw: 'Network error during payment',
    has_recovery_consent: true, contact_count: 0, max_contact_count: 2, demo_case: false, status: 'new'
  }
];

// ─── Main seeding function ────────────────────────────────────────

async function seedData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[Seed] Connected to MongoDB');

    // Clear existing cases
    await Case.deleteMany({});
    console.log('[Seed] Cleared existing cases');

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
