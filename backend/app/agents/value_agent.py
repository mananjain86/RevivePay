import logging
from app.config.gemini_client import call_gemini
from app.models.case import Case, ValueAssessment, Priority

logger = logging.getLogger(__name__)

VALID_PRIORITIES = ['high', 'medium', 'low']

VALUE_SCHEMA = {
    "type": "object",
    "properties": {
        "priority": {
            "type": "string",
            "description": "Recovery priority: high, medium, or low",
            "enum": VALID_PRIORITIES
        },
        "cart_value": {
            "type": "number",
            "description": "The order/cart value in rupees (should match the provided amount)"
        },
        "is_repeat_buyer": {
            "type": "boolean",
            "description": "Whether this is a repeat customer (should match provided data)"
        },
        "attempt_number": {
            "type": "number",
            "description": "Current attempt number (should match provided data)"
        }
    },
    "required": ["priority", "cart_value", "is_repeat_buyer", "attempt_number"]
}

SYSTEM_PROMPT = """You are a customer value assessment specialist for an Indian e-commerce platform's revenue recovery team.

Your job is to assess the PRIORITY of recovering a failed payment or abandoned checkout.

Consider these factors when judging priority:
- Higher amounts deserve higher priority (₹5000+ is high, ₹1000-5000 is medium, below ₹1000 is low — but adjust based on other factors)
- Repeat buyers are more valuable — recovering them preserves long-term revenue
- First attempts are more likely to succeed than third attempts
- Abandoned checkouts from repeat buyers on high-value items are very high priority

Rate as:
- "high": Significant revenue at risk, good chance of recovery, or important customer to retain
- "medium": Moderate revenue, reasonable recovery chance
- "low": Small amount, unlikely to succeed, or low customer value

Also echo back the cart_value, is_repeat_buyer, and attempt_number from the input data as a sanity check."""

async def assess_value(case_data: Case) -> ValueAssessment:
    user_prompt = f"""Assess the recovery priority for this case:
- Case type: {case_data.case_type.value}
- Amount: ₹{case_data.amount}
- Is repeat buyer: {case_data.is_repeat_buyer}
- Attempt number: {case_data.attempt_number}"""

    try:
        result = await call_gemini(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            response_schema=VALUE_SCHEMA,
            agent_name='value'
        )
        return validate_value_assessment(result, case_data)
    except Exception as e:
        logger.error(f"[ValueAgent] Error for case {case_data.id}: {str(e)}")
        return ValueAssessment(
            priority=Priority.LOW,
            cart_value=case_data.amount,
            is_repeat_buyer=case_data.is_repeat_buyer,
            attempt_number=case_data.attempt_number
        )

def validate_value_assessment(result: dict, case_data: Case) -> ValueAssessment:
    priority = result.get('priority')
    if priority not in VALID_PRIORITIES:
        priority = 'low'

    return ValueAssessment(
        priority=Priority(priority),
        cart_value=case_data.amount,
        is_repeat_buyer=case_data.is_repeat_buyer,
        attempt_number=case_data.attempt_number
    )
