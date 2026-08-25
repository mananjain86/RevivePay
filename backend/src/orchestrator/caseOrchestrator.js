/**
 * caseOrchestrator.js — Runs a case through the full recovery pipeline.
 *
 * Pipeline: atomic claim → diagnose → assess value → plan → policy check →
 *   branch on decision (approve/reject-fallback/merchant-approval/block) → execute
 *
 * Key behaviors:
 * - Atomic case claiming via findOneAndUpdate (prevents double-processing)
 * - DEMO_MODE fixture substitution for 3 scripted demo cases
 * - Gemini failure fallbacks (never crash the pipeline)
 * - Fallback re-check: REJECTED_FALLBACK plans re-run through checkPolicy()
 * - Status set by executor, not forced to "recovered" by orchestrator
 */

const Case = require('../models/Case');
const { diagnoseCase } = require('../agents/diagnosisAgent');
const { assessValue } = require('../agents/valueAgent');
const { planRecovery } = require('../agents/plannerAgent');
const { checkPolicy } = require('../policy/policyGuard');
const { executeSimulated } = require('../execution/simulatedExecutor');
const { executeRazorpay } = require('../execution/razorpayExecutor');
const demoFixtures = require('../data/demoFixtures');

/**
 * Process a single case through the full recovery pipeline.
 *
 * @param {string} caseId - MongoDB ObjectId of the case
 * @returns {Promise<object>} The final case document
 */
async function processCase(caseId) {
  // ─── Step 0: Atomic claim ───────────────────────────────────────
  // Only one caller can transition "new" → "processing" for a given case
  const caseDoc = await Case.findOneAndUpdate(
    { _id: caseId, status: 'new' },
    { $set: { status: 'processing' } },
    { new: true }
  );

  if (!caseDoc) {
    // Another job already claimed this case — skip
    console.log(`[Orchestrator] Case ${caseId} already claimed or not 'new' — skipping`);
    return null;
  }

  const isDemoMode = process.env.DEMO_MODE === 'true';
  const fixture = isDemoMode ? demoFixtures[caseDoc.customer_id] : null;

  try {
    // ─── Step 1: Diagnosis ──────────────────────────────────────────
    let diagnosis;
    if (fixture && fixture.diagnosis) {
      diagnosis = fixture.diagnosis;
      console.log(`[Orchestrator] DEMO_MODE: Using fixture diagnosis for ${caseDoc.customer_id}`);
    } else {
      diagnosis = await diagnoseCase(caseDoc);
    }

    caseDoc.diagnosis = diagnosis;
    caseDoc.status = 'diagnosed';
    caseDoc.audit_log.push({
      stage: 'diagnosis',
      timestamp: new Date(),
      output: diagnosis
    });
    await caseDoc.save();

    // ─── Step 2: Value Assessment ───────────────────────────────────
    let valueAssessment;
    if (fixture && fixture.value_assessment) {
      valueAssessment = fixture.value_assessment;
      console.log(`[Orchestrator] DEMO_MODE: Using fixture value_assessment for ${caseDoc.customer_id}`);
    } else {
      valueAssessment = await assessValue(caseDoc);
    }

    caseDoc.value_assessment = valueAssessment;
    caseDoc.status = 'valued';
    caseDoc.audit_log.push({
      stage: 'value_assessment',
      timestamp: new Date(),
      output: valueAssessment
    });
    await caseDoc.save();

    // ─── Step 3: Recovery Plan ──────────────────────────────────────
    let plan;
    if (fixture && fixture.plan) {
      plan = fixture.plan;
      console.log(`[Orchestrator] DEMO_MODE: Using fixture plan for ${caseDoc.customer_id}`);
    } else {
      plan = await planRecovery(caseDoc, diagnosis, valueAssessment);
    }

    caseDoc.plan = plan;
    caseDoc.status = 'planned';
    caseDoc.audit_log.push({
      stage: 'plan',
      timestamp: new Date(),
      output: plan
    });
    await caseDoc.save();

    // ─── Step 4: Policy Check (synchronous, no LLM) ────────────────
    const policyResult = checkPolicy(caseDoc, plan);
    caseDoc.policy_check = policyResult;
    caseDoc.status = 'policy_checked';
    caseDoc.audit_log.push({
      stage: 'policy_check',
      timestamp: new Date(),
      output: policyResult
    });
    await caseDoc.save();

    // ─── Step 5: Branch on policy decision ──────────────────────────
    switch (policyResult.decision) {
      case 'APPROVED':
        return await handleApproved(caseDoc, plan);

      case 'REJECTED_FALLBACK':
        return await handleRejectedFallback(caseDoc, plan, policyResult);

      case 'NEEDS_MERCHANT_APPROVAL':
        caseDoc.status = 'needs_merchant_approval';
        caseDoc.merchant_approval.required = true;
        await caseDoc.save();
        console.log(`[Orchestrator] Case ${caseDoc._id} → needs_merchant_approval`);
        return caseDoc;

      case 'BLOCKED_STOP_RULE':
        caseDoc.status = 'stopped_safely';
        caseDoc.audit_log.push({
          stage: 'stopped_safely',
          timestamp: new Date(),
          output: { reason: policyResult.reason }
        });
        await caseDoc.save();
        console.log(`[Orchestrator] Case ${caseDoc._id} → stopped_safely: ${policyResult.reason}`);
        return caseDoc;

      case 'BLOCKED_NO_CONSENT':
        caseDoc.status = 'blocked_no_consent';
        caseDoc.audit_log.push({
          stage: 'blocked_no_consent',
          timestamp: new Date(),
          output: { reason: policyResult.reason }
        });
        await caseDoc.save();
        console.log(`[Orchestrator] Case ${caseDoc._id} → blocked_no_consent`);
        return caseDoc;

      default:
        console.error(`[Orchestrator] Unknown policy decision: ${policyResult.decision}`);
        caseDoc.status = 'stopped_safely';
        await caseDoc.save();
        return caseDoc;
    }
  } catch (error) {
    console.error(`[Orchestrator] Fatal error processing case ${caseId}:`, error);
    // Mark as execution_failed so we don't retry
    caseDoc.status = 'execution_failed';
    caseDoc.audit_log.push({
      stage: 'orchestrator_error',
      timestamp: new Date(),
      output: { error: error.message }
    });
    await caseDoc.save();
    return caseDoc;
  }
}

/**
 * Handle APPROVED decision — pick executor and execute.
 */
async function handleApproved(caseDoc, plan) {
  caseDoc.status = 'approved';

  // Pick executor based on demo_case flag
  const executorResult = caseDoc.demo_case
    ? await executeRazorpay(caseDoc, plan)
    : executeSimulated(caseDoc, plan);

  // Apply execution results
  caseDoc.execution = executorResult.execution;
  caseDoc.status = executorResult.status;

  if (executorResult.contact_count !== undefined) {
    caseDoc.contact_count = executorResult.contact_count;
  }
  if (executorResult.last_contacted_at) {
    caseDoc.last_contacted_at = executorResult.last_contacted_at;
  }

  caseDoc.audit_log.push({
    stage: 'execution',
    timestamp: new Date(),
    output: {
      ...executorResult.execution,
      final_status: executorResult.status,
      payment_link_url: executorResult.payment_link_url || null
    }
  });

  await caseDoc.save();
  console.log(`[Orchestrator] Case ${caseDoc._id} → ${executorResult.status} (${executorResult.execution.executor_type})`);
  return caseDoc;
}

/**
 * Handle REJECTED_FALLBACK — build fallback plan, re-check policy, then branch.
 *
 * v3 fix: fallback plans MUST clear checkPolicy() again on their own merits.
 * A fallback is never auto-approved just because it dodged the original rejection.
 */
async function handleRejectedFallback(caseDoc, originalPlan, originalPolicyResult) {
  // Log the original rejection
  caseDoc.audit_log.push({
    stage: 'policy_rejected_fallback',
    timestamp: new Date(),
    output: {
      original_plan: originalPlan,
      original_policy_decision: originalPolicyResult,
      message: `Original plan rejected: ${originalPolicyResult.reason}. Falling back to ${originalPolicyResult.fallback_action}.`
    }
  });

  // Build the fallback plan
  const fallbackPlan = {
    recommendation: originalPolicyResult.fallback_action || 'CREATE_PAYMENT_LINK',
    discount_requested_pct: 0,
    confidence: originalPlan.confidence,
    reasoning: `Fallback: original plan rejected (${originalPolicyResult.reason}), downgraded to plain payment link`
  };

  // Re-check policy on the FALLBACK plan (v3 Section 6.5 — critical fix)
  const fallbackPolicyResult = checkPolicy(caseDoc, fallbackPlan);
  caseDoc.fallback_policy_check = fallbackPolicyResult;

  caseDoc.audit_log.push({
    stage: 'fallback_policy_check',
    timestamp: new Date(),
    output: {
      fallback_plan: fallbackPlan,
      fallback_policy_result: fallbackPolicyResult
    }
  });

  await caseDoc.save();

  // Branch on the SECOND policy check
  switch (fallbackPolicyResult.decision) {
    case 'APPROVED':
      return await handleApproved(caseDoc, fallbackPlan);

    case 'NEEDS_MERCHANT_APPROVAL':
      caseDoc.status = 'needs_merchant_approval';
      caseDoc.merchant_approval.required = true;
      // Store the fallback plan as the active plan for when merchant approves
      caseDoc.plan = fallbackPlan;
      await caseDoc.save();
      console.log(`[Orchestrator] Fallback for case ${caseDoc._id} → needs_merchant_approval`);
      return caseDoc;

    case 'BLOCKED_STOP_RULE':
      caseDoc.status = 'stopped_safely';
      caseDoc.audit_log.push({
        stage: 'fallback_blocked',
        timestamp: new Date(),
        output: { reason: fallbackPolicyResult.reason }
      });
      await caseDoc.save();
      console.log(`[Orchestrator] Fallback for case ${caseDoc._id} → stopped_safely`);
      return caseDoc;

    default:
      caseDoc.status = 'stopped_safely';
      await caseDoc.save();
      return caseDoc;
  }
}

/**
 * Resolve a merchant approval decision.
 *
 * Called when a human approves or rejects a case from the approval queue.
 * If approved, re-enters the same execution branch as APPROVED.
 *
 * @param {string} caseId - MongoDB ObjectId
 * @param {boolean} approvedByMerchant - true = approve, false = reject
 * @returns {Promise<object>} The updated case document
 */
async function resolveApproval(caseId, approvedByMerchant) {
  const caseDoc = await Case.findById(caseId);

  if (!caseDoc) {
    throw new Error(`Case ${caseId} not found`);
  }

  if (caseDoc.status !== 'needs_merchant_approval') {
    throw new Error(`Case ${caseId} is not pending approval (status: ${caseDoc.status})`);
  }

  if (approvedByMerchant) {
    caseDoc.merchant_approval.approved_by_merchant = true;
    caseDoc.merchant_approval.approved_at = new Date();
    caseDoc.status = 'approved';

    caseDoc.audit_log.push({
      stage: 'merchant_approved',
      timestamp: new Date(),
      output: { approved_by_merchant: true }
    });

    await caseDoc.save();

    // Re-enter the execution branch with the current plan
    return await handleApproved(caseDoc, caseDoc.plan);
  } else {
    caseDoc.merchant_approval.approved_by_merchant = false;
    caseDoc.status = 'stopped_safely';

    caseDoc.audit_log.push({
      stage: 'merchant_rejected',
      timestamp: new Date(),
      output: { approved_by_merchant: false }
    });

    await caseDoc.save();
    console.log(`[Orchestrator] Case ${caseId} → stopped_safely (merchant rejected)`);
    return caseDoc;
  }
}

module.exports = { processCase, resolveApproval };
