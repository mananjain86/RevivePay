import os
import logging
from datetime import datetime, timezone
from beanie.odm.operators.update.general import Set
from bson import ObjectId

from app.models.case import Case, CaseStatus, AuditLogEntry
from app.agents.diagnosis_agent import diagnose_case
from app.agents.value_agent import assess_value
from app.agents.planner_agent import plan_recovery
from app.policy.policy_guard import check_policy
from app.execution.simulated_executor import execute_simulated
from app.execution.razorpay_executor import execute_razorpay
from app.data.demo_fixtures import demo_fixtures

logger = logging.getLogger(__name__)

async def process_case(case_id: str) -> Case:
    # ─── Step 0: Atomic claim ───────────────────────────────────────
    # In Beanie, find_one_and_update is atomic
    case_doc = await Case.find_one({"_id": ObjectId(case_id), "status": CaseStatus.NEW}).update(
        Set({Case.status: CaseStatus.PROCESSING}),
        response_type="NEW_DOCUMENT"
    )

    if not case_doc:
        logger.info(f"[Orchestrator] Case {case_id} already claimed or not 'new' — skipping")
        return None

    is_demo_mode = os.environ.get('DEMO_MODE') == 'true'
    fixture = demo_fixtures.get(case_doc.customer_id) if is_demo_mode else None

    try:
        # ─── Step 1: Diagnosis ──────────────────────────────────────────
        if fixture and fixture.get('diagnosis'):
            diagnosis = fixture['diagnosis']
            logger.info(f"[Orchestrator] DEMO_MODE: Using fixture diagnosis for {case_doc.customer_id}")
        else:
            diagnosis = await diagnose_case(case_doc)

        case_doc.diagnosis = diagnosis
        case_doc.status = CaseStatus.DIAGNOSED
        case_doc.audit_log.append(AuditLogEntry(
            stage='diagnosis',
            timestamp=datetime.now(timezone.utc),
            output=diagnosis.model_dump(mode='json')
        ))
        await case_doc.save()

        # ─── Step 2: Value Assessment ───────────────────────────────────
        if fixture and fixture.get('value_assessment'):
            value_assessment = fixture['value_assessment']
            logger.info(f"[Orchestrator] DEMO_MODE: Using fixture value_assessment for {case_doc.customer_id}")
        else:
            value_assessment = await assess_value(case_doc)

        case_doc.value_assessment = value_assessment
        case_doc.status = CaseStatus.VALUED
        case_doc.audit_log.append(AuditLogEntry(
            stage='value_assessment',
            timestamp=datetime.now(timezone.utc),
            output=value_assessment.model_dump(mode='json')
        ))
        await case_doc.save()

        # ─── Step 3: Recovery Plan ──────────────────────────────────────
        if fixture and fixture.get('plan'):
            plan = fixture['plan']
            logger.info(f"[Orchestrator] DEMO_MODE: Using fixture plan for {case_doc.customer_id}")
        else:
            plan = await plan_recovery(case_doc, diagnosis, value_assessment)

        case_doc.plan = plan
        case_doc.status = CaseStatus.PLANNED
        case_doc.audit_log.append(AuditLogEntry(
            stage='plan',
            timestamp=datetime.now(timezone.utc),
            output=plan.model_dump(mode='json')
        ))
        await case_doc.save()

        # ─── Step 4: Policy Check ───────────────────────────────────────
        policy_result = check_policy(case_doc, plan)
        case_doc.policy_check = policy_result
        case_doc.status = CaseStatus.POLICY_CHECKED
        case_doc.audit_log.append(AuditLogEntry(
            stage='policy_check',
            timestamp=datetime.now(timezone.utc),
            output=policy_result.model_dump(mode='json')
        ))
        await case_doc.save()

        # ─── Step 5: Branch on policy decision ──────────────────────────
        decision = policy_result.decision.value if policy_result.decision else ''
        if decision == 'APPROVED':
            return await handle_approved(case_doc, plan)
        elif decision == 'REJECTED_FALLBACK':
            return await handle_rejected_fallback(case_doc, plan, policy_result)
        elif decision == 'NEEDS_MERCHANT_APPROVAL':
            case_doc.status = CaseStatus.NEEDS_MERCHANT_APPROVAL
            case_doc.merchant_approval.required = True
            await case_doc.save()
            logger.info(f"[Orchestrator] Case {case_doc.id} → needs_merchant_approval")
            return case_doc
        elif decision == 'BLOCKED_STOP_RULE':
            case_doc.status = CaseStatus.STOPPED_SAFELY
            case_doc.audit_log.append(AuditLogEntry(
                stage='stopped_safely',
                timestamp=datetime.now(timezone.utc),
                output={"reason": policy_result.reason}
            ))
            await case_doc.save()
            logger.info(f"[Orchestrator] Case {case_doc.id} → stopped_safely: {policy_result.reason}")
            return case_doc
        elif decision == 'BLOCKED_NO_CONSENT':
            case_doc.status = CaseStatus.BLOCKED_NO_CONSENT
            case_doc.audit_log.append(AuditLogEntry(
                stage='blocked_no_consent',
                timestamp=datetime.now(timezone.utc),
                output={"reason": policy_result.reason}
            ))
            await case_doc.save()
            logger.info(f"[Orchestrator] Case {case_doc.id} → blocked_no_consent")
            return case_doc
        else:
            logger.error(f"[Orchestrator] Unknown policy decision: {decision}")
            case_doc.status = CaseStatus.STOPPED_SAFELY
            await case_doc.save()
            return case_doc

    except Exception as e:
        logger.error(f"[Orchestrator] Fatal error processing case {case_id}: {str(e)}")
        case_doc.status = CaseStatus.EXECUTION_FAILED
        case_doc.audit_log.append(AuditLogEntry(
            stage='orchestrator_error',
            timestamp=datetime.now(timezone.utc),
            output={"error": str(e)}
        ))
        await case_doc.save()
        return case_doc

async def handle_approved(case_doc: Case, plan):
    case_doc.status = CaseStatus.APPROVED

    if case_doc.demo_case:
        executor_result = await execute_razorpay(case_doc, plan)
    else:
        executor_result = execute_simulated(case_doc, plan)

    case_doc.execution = executor_result['execution']
    case_doc.status = executor_result['status']

    if 'contact_count' in executor_result:
        case_doc.contact_count = executor_result['contact_count']
    if 'last_contacted_at' in executor_result:
        case_doc.last_contacted_at = executor_result['last_contacted_at']
    if 'discount_cost' in executor_result:
        case_doc.discount_cost = executor_result['discount_cost']
    if 'contact_cost' in executor_result:
        case_doc.contact_cost = executor_result['contact_cost']

    output = executor_result['execution'].model_dump(mode='json')
    output['final_status'] = executor_result['status'].value if executor_result['status'] else None
    if executor_result.get('payment_link_url'):
        output['payment_link_url'] = executor_result['payment_link_url']

    case_doc.audit_log.append(AuditLogEntry(
        stage='execution',
        timestamp=datetime.now(timezone.utc),
        output=output
    ))

    await case_doc.save()
    logger.info(f"[Orchestrator] Case {case_doc.id} → {case_doc.status.value} ({case_doc.execution.executor_type.value})")
    return case_doc

async def handle_rejected_fallback(case_doc: Case, original_plan, original_policy_result):
    from app.models.case import Plan, Recommendation, FallbackPolicyCheck, FallbackPolicyDecision
    case_doc.audit_log.append(AuditLogEntry(
        stage='policy_rejected_fallback',
        timestamp=datetime.now(timezone.utc),
        output={
            "original_plan": original_plan.model_dump(mode='json') if original_plan else None,
            "original_policy_decision": original_policy_result.model_dump(mode='json') if original_policy_result else None,
            "message": f"Original plan rejected: {original_policy_result.reason}. Falling back to {original_policy_result.fallback_action}."
        }
    ))

    fallback_plan = Plan(
        recommendation=Recommendation(original_policy_result.fallback_action) if original_policy_result.fallback_action else Recommendation.CREATE_PAYMENT_LINK,
        discount_requested_pct=0.0,
        confidence=original_plan.confidence,
        reasoning=f"Fallback: original plan rejected ({original_policy_result.reason}), downgraded to plain payment link"
    )

    fallback_policy_result = check_policy(case_doc, fallback_plan)
    case_doc.fallback_policy_check = FallbackPolicyCheck(
        decision=FallbackPolicyDecision(fallback_policy_result.decision.value) if fallback_policy_result.decision else None,
        reason=fallback_policy_result.reason
    )

    case_doc.audit_log.append(AuditLogEntry(
        stage='fallback_policy_check',
        timestamp=datetime.now(timezone.utc),
        output={
            "fallback_plan": fallback_plan.model_dump(mode='json'),
            "fallback_policy_result": fallback_policy_result.model_dump(mode='json')
        }
    ))

    await case_doc.save()

    decision = fallback_policy_result.decision.value if fallback_policy_result.decision else ''
    if decision == 'APPROVED':
        return await handle_approved(case_doc, fallback_plan)
    elif decision == 'NEEDS_MERCHANT_APPROVAL':
        case_doc.status = CaseStatus.NEEDS_MERCHANT_APPROVAL
        case_doc.merchant_approval.required = True
        case_doc.plan = fallback_plan
        await case_doc.save()
        logger.info(f"[Orchestrator] Fallback for case {case_doc.id} → needs_merchant_approval")
        return case_doc
    elif decision == 'BLOCKED_STOP_RULE':
        case_doc.status = CaseStatus.STOPPED_SAFELY
        case_doc.audit_log.append(AuditLogEntry(
            stage='fallback_blocked',
            timestamp=datetime.now(timezone.utc),
            output={"reason": fallback_policy_result.reason}
        ))
        await case_doc.save()
        logger.info(f"[Orchestrator] Fallback for case {case_doc.id} → stopped_safely")
        return case_doc
    else:
        case_doc.status = CaseStatus.STOPPED_SAFELY
        await case_doc.save()
        return case_doc

async def resolve_approval(case_id: str, approved_by_merchant: bool) -> Case:
    case_doc = await Case.get(ObjectId(case_id))
    if not case_doc:
        raise ValueError(f"Case {case_id} not found")

    if case_doc.status != CaseStatus.NEEDS_MERCHANT_APPROVAL:
        raise ValueError(f"Case {case_id} is not pending approval (status: {case_doc.status})")

    if approved_by_merchant:
        case_doc.merchant_approval.approved_by_merchant = True
        case_doc.merchant_approval.approved_at = datetime.now(timezone.utc)
        case_doc.status = CaseStatus.APPROVED

        case_doc.audit_log.append(AuditLogEntry(
            stage='merchant_approved',
            timestamp=datetime.now(timezone.utc),
            output={"approved_by_merchant": True}
        ))
        await case_doc.save()
        return await handle_approved(case_doc, case_doc.plan)
    else:
        case_doc.merchant_approval.approved_by_merchant = False
        case_doc.status = CaseStatus.STOPPED_SAFELY

        case_doc.audit_log.append(AuditLogEntry(
            stage='merchant_rejected',
            timestamp=datetime.now(timezone.utc),
            output={"approved_by_merchant": False}
        ))
        await case_doc.save()
        logger.info(f"[Orchestrator] Case {case_id} → stopped_safely (merchant rejected)")
        return case_doc
