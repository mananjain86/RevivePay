import logging
from app.config.gemini_client import call_gemini
from app.models.case import Case, Diagnosis, ValueAssessment, Plan, Recommendation

logger = logging.getLogger(__name__)

VALID_RECOMMENDATIONS = [
    'CREATE_PAYMENT_LINK', 'SEND_REMINDER', 'OFFER_DISCOUNT',
    'ESCALATE_TO_HUMAN', 'DO_NOT_CONTACT'
]

PLANNER_SCHEMA = {
    "type": "object",
    "properties": {
        "recommendation": {
            "type": "string",
            "description": "The recommended recovery action. Must be exactly one of: CREATE_PAYMENT_LINK, SEND_REMINDER, OFFER_DISCOUNT, ESCALATE_TO_HUMAN, DO_NOT_CONTACT",
            "enum": VALID_RECOMMENDATIONS
        },
        "reasoning": {
            "type": "string",
            "description": "Brief 1-2 sentence explanation of why this action was chosen"
        },
        "confidence": {
            "type": "number",
            "description": "Confidence score from 0.0 to 1.0 inclusive"
        },
        "discount_requested_pct": {
            "type": "number",
            "description": "Discount percentage (0-100). Should be 0 unless recommendation is OFFER_DISCOUNT"
        }
    },
    "required": ["recommendation", "reasoning", "confidence", "discount_requested_pct"]
}

SYSTEM_PROMPT = """You are a recovery action planner for an Indian e-commerce platform's AI revenue recovery system.

Given the diagnosis (why a payment failed) and the value assessment (how important this case is), recommend ONE recovery action.

You may ONLY choose from these exact 5 actions — never invent a sixth:

1. CREATE_PAYMENT_LINK — Generate a fresh Razorpay payment link for the customer. Best for transient failures, first attempts, or when a simple retry is likely to work.
2. SEND_REMINDER — Send a reminder message to the customer. Best for abandoned checkouts or when waiting before a payment link makes sense.
3. OFFER_DISCOUNT — Offer a percentage discount to incentivize completion. ONLY use this for high-value cases where the customer needs a nudge (e.g., abandoned cart with hesitation). Specify the discount_requested_pct (1-10 range typically).
4. ESCALATE_TO_HUMAN — Route this case to a human agent for manual review. Use when the situation is complex, ambiguous, or when you have low confidence.
5. DO_NOT_CONTACT — Do not attempt recovery. Use ONLY for cases where contact would be inappropriate (e.g., clear fraud signals, customer explicitly cancelled).

Guidelines:
- For first-attempt transient failures with high value: CREATE_PAYMENT_LINK (high confidence)
- For abandoned checkouts from repeat buyers with high cart value: consider OFFER_DISCOUNT with a small percentage (3-5%)
- For repeated failures (attempt >= 2): be more cautious, lower confidence
- For unknown/ambiguous failures: ESCALATE_TO_HUMAN
- Never recommend DO_NOT_CONTACT unless there's a strong reason — it discards a possibly-recoverable case
- Set discount_requested_pct to 0 unless recommending OFFER_DISCOUNT"""

async def plan_recovery(case_data: Case, diagnosis: Diagnosis, value_assessment: ValueAssessment) -> Plan:
    user_prompt = f"""Plan the recovery action for this case:

Case details:
- Type: {case_data.case_type.value}
- Amount: ₹{case_data.amount}
- Attempt: {case_data.attempt_number}
- Repeat buyer: {case_data.is_repeat_buyer}
- Raw failure: {case_data.failure_reason_raw or 'N/A'}

Diagnosis:
- Failure class: {diagnosis.failure_class.value if diagnosis.failure_class else 'N/A'}
- Confidence: {diagnosis.confidence}
- Reasoning: {diagnosis.reasoning}

Value Assessment:
- Priority: {value_assessment.priority.value if value_assessment.priority else 'N/A'}
- Cart value: ₹{value_assessment.cart_value}"""

    try:
        result = await call_gemini(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            response_schema=PLANNER_SCHEMA,
            agent_name='planner'
        )
        return validate_plan(result)
    except Exception as e:
        logger.error(f"[PlannerAgent] Error for case {case_data.id}: {str(e)}")
        return Plan(
            recommendation=Recommendation.ESCALATE_TO_HUMAN,
            reasoning='agent_error_fallback',
            confidence=0.0,
            discount_requested_pct=0.0
        )

def validate_plan(result: dict) -> Plan:
    recommendation = result.get('recommendation')
    reasoning = result.get('reasoning')
    confidence = result.get('confidence')
    discount_requested_pct = result.get('discount_requested_pct')

    if recommendation not in VALID_RECOMMENDATIONS:
        recommendation = 'ESCALATE_TO_HUMAN'

    if not isinstance(confidence, (int, float)):
        confidence = 0.0
    confidence = max(0.0, min(1.0, float(confidence)))

    if not isinstance(discount_requested_pct, (int, float)):
        discount_requested_pct = 0.0
    discount_requested_pct = max(0.0, min(100.0, float(discount_requested_pct)))

    if recommendation != 'OFFER_DISCOUNT':
        discount_requested_pct = 0.0

    if not isinstance(reasoning, str) or not reasoning:
        reasoning = 'No reasoning provided'

    return Plan(
        recommendation=Recommendation(recommendation),
        reasoning=reasoning,
        confidence=confidence,
        discount_requested_pct=discount_requested_pct
    )
