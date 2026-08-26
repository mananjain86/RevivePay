import logging
from datetime import datetime, timezone
from app.models.case import Case, Plan, Execution, ExecutorType, ExecutionResult, PaymentLinkStatus, CaseStatus
from app.config.razorpay_client import razorpay_client

logger = logging.getLogger(__name__)

async def execute_razorpay(case_data: Case, plan: Plan) -> dict:
    now = datetime.now(timezone.utc)
    recommendation = plan.recommendation.value if plan.recommendation else None

    if recommendation in ['CREATE_PAYMENT_LINK', 'OFFER_DISCOUNT']:
        try:
            final_amount = case_data.amount
            discount_cost = 0.0

            if recommendation == 'OFFER_DISCOUNT' and plan.discount_requested_pct and plan.discount_requested_pct > 0:
                discount_multiplier = 1.0 - (plan.discount_requested_pct / 100.0)
                final_amount = round(case_data.amount * discount_multiplier)
                discount_cost = case_data.amount - final_amount

            # Convert to paise
            amount_in_paise = int(final_amount * 100)

            # Create payment link synchronously via razorpay client (which is blocking, but fast enough for this demo, we could wrap in asyncio.to_thread if needed)
            payment_link = razorpay_client.payment_link.create({
                "amount": amount_in_paise,
                "currency": case_data.currency or 'INR',
                "description": f"RevivePay Recovery - Case {case_data.id}",
                "customer": {
                    "name": f"Customer {case_data.customer_id}",
                    "contact": "+919876543210"
                },
                "notify": {
                    "sms": False,
                    "email": False
                },
                "reminder_enable": False,
                "notes": {
                    "case_id": str(case_data.id),
                    "original_amount": case_data.amount,
                    "discount_pct": plan.discount_requested_pct or 0.0,
                    "source": "revivepay"
                }
            })

            return {
                "execution": Execution(
                    executor_type=ExecutorType.RAZORPAY,
                    action_taken=recommendation,
                    result=ExecutionResult.SUCCESS,
                    razorpay_reference=payment_link['id'],
                    payment_link_status=PaymentLinkStatus.CREATED,
                    timestamp=now
                ),
                "status": CaseStatus.AWAITING_PAYMENT,
                "contact_count": case_data.contact_count + 1,
                "last_contacted_at": now,
                "discount_cost": discount_cost,
                "contact_cost": (case_data.contact_count + 1) * 2.0,
                "payment_link_url": payment_link.get('short_url')
            }
        except Exception as e:
            logger.error(f"[RazorpayExecutor] Error creating payment link for case {case_data.id}: {str(e)}")
            return {
                "execution": Execution(
                    executor_type=ExecutorType.RAZORPAY,
                    action_taken=recommendation,
                    result=ExecutionResult.FAILURE,
                    razorpay_reference=None,
                    payment_link_status=None,
                    timestamp=now
                ),
                "status": CaseStatus.EXECUTION_FAILED
            }

    if recommendation == 'SEND_REMINDER':
        logger.info(f"[RazorpayExecutor] Simulated reminder for case {case_data.id}")
        return {
            "execution": Execution(
                executor_type=ExecutorType.RAZORPAY,
                action_taken='SEND_REMINDER',
                result=ExecutionResult.SUCCESS,
                razorpay_reference=None,
                payment_link_status=None,
                timestamp=now
            ),
            "status": CaseStatus.LINK_CREATED,
            "contact_count": case_data.contact_count + 1,
            "last_contacted_at": now,
            "contact_cost": (case_data.contact_count + 1) * 2.0
        }

    return {
        "execution": Execution(
            executor_type=ExecutorType.RAZORPAY,
            action_taken=recommendation,
            result=ExecutionResult.NOT_ATTEMPTED,
            razorpay_reference=None,
            payment_link_status=None,
            timestamp=now
        ),
        "status": CaseStatus.STOPPED_SAFELY if recommendation == 'DO_NOT_CONTACT' else CaseStatus.NEEDS_MERCHANT_APPROVAL
    }
