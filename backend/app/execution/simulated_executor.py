from datetime import datetime, timezone
from app.models.case import Case, Plan, Execution, ExecutorType, ExecutionResult, PaymentLinkStatus, CaseStatus
from app.utils.seeded_random import create_seeded_rng

def execute_simulated(case_data: Case, plan: Plan) -> dict:
    rng = create_seeded_rng(str(case_data.id))
    now = datetime.now(timezone.utc)
    recommendation = plan.recommendation.value if plan.recommendation else None

    if recommendation in ['CREATE_PAYMENT_LINK', 'OFFER_DISCOUNT']:
        sim_reference = f"sim_plink_{str(case_data.id)[-8:]}"
        payment_outcome = rng()

        payment_link_status = None
        status = None

        if payment_outcome < 0.65:
            payment_link_status = PaymentLinkStatus.PAID
            status = CaseStatus.RECOVERED
        elif payment_outcome < 0.85:
            payment_link_status = PaymentLinkStatus.EXPIRED
            status = CaseStatus.UNRECOVERED_EXPIRED
        else:
            payment_link_status = PaymentLinkStatus.CREATED
            status = CaseStatus.LINK_CREATED

        return {
            "execution": Execution(
                executor_type=ExecutorType.SIMULATED,
                action_taken=recommendation,
                result=ExecutionResult.SUCCESS,
                razorpay_reference=sim_reference,
                payment_link_status=payment_link_status,
                timestamp=now
            ),
            "status": status,
            "contact_count": case_data.contact_count + 1,
            "last_contacted_at": now
        }

    if recommendation == 'SEND_REMINDER':
        return {
            "execution": Execution(
                executor_type=ExecutorType.SIMULATED,
                action_taken='SEND_REMINDER',
                result=ExecutionResult.SUCCESS,
                razorpay_reference=None,
                payment_link_status=None,
                timestamp=now
            ),
            "status": CaseStatus.LINK_CREATED,
            "contact_count": case_data.contact_count + 1,
            "last_contacted_at": now
        }

    return {
        "execution": Execution(
            executor_type=ExecutorType.SIMULATED,
            action_taken=recommendation,
            result=ExecutionResult.NOT_ATTEMPTED,
            razorpay_reference=None,
            payment_link_status=None,
            timestamp=now
        ),
        "status": CaseStatus.STOPPED_SAFELY if recommendation == 'DO_NOT_CONTACT' else CaseStatus.NEEDS_MERCHANT_APPROVAL
    }
