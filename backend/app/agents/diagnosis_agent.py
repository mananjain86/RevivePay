import logging
from app.config.gemini_client import call_gemini
from app.models.case import Case, Diagnosis, FailureClass

logger = logging.getLogger(__name__)

VALID_FAILURE_CLASSES = [
    'insufficient_funds', 'expired_card', 'technical_decline',
    'bank_error', 'checkout_abandoned', 'unknown'
]

DIAGNOSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "failure_class": {
            "type": "string",
            "description": "The classified cause of the payment failure. Must be one of: insufficient_funds, expired_card, technical_decline, bank_error, checkout_abandoned, unknown",
            "enum": VALID_FAILURE_CLASSES
        },
        "confidence": {
            "type": "number",
            "description": "Confidence score from 0.0 to 1.0 inclusive"
        },
        "reasoning": {
            "type": "string",
            "description": "Brief 1-2 sentence explanation of the diagnosis"
        }
    },
    "required": ["failure_class", "confidence", "reasoning"]
}

SYSTEM_PROMPT = """You are a payment failure diagnosis specialist for an Indian e-commerce platform.
Your job is to analyze a failed payment or abandoned checkout and classify the root cause.

You will be given:
- case_type: either "failed_payment" or "abandoned_checkout"
- failure_reason_raw: the raw error message or abandonment context
- attempt_number: how many times this payment has been attempted

Classify the failure into exactly one of these categories:
- insufficient_funds: customer's account/card has insufficient balance
- expired_card: the payment card has expired
- technical_decline: a temporary technical issue (UPI timeout, gateway error, 3DS failure)
- bank_error: the issuing bank declined for non-card-expiry reasons (blocked card, daily limit, server down)
- checkout_abandoned: customer left the checkout flow voluntarily (not a payment error)
- unknown: cannot determine the cause with reasonable confidence

Be precise with your confidence score. High confidence (0.8+) only when the raw reason clearly maps to one category. Lower confidence when the reason is ambiguous."""

async def diagnose_case(case_data: Case) -> Diagnosis:
    user_prompt = f"""Diagnose this case:
- Case type: {case_data.case_type.value}
- Failure reason: {case_data.failure_reason_raw or 'No reason provided'}
- Attempt number: {case_data.attempt_number}"""

    try:
        result = await call_gemini(
            system_prompt=SYSTEM_PROMPT,
            user_prompt=user_prompt,
            response_schema=DIAGNOSIS_SCHEMA,
            agent_name='diagnosis'
        )
        return validate_diagnosis(result)
    except Exception as e:
        logger.error(f"[DiagnosisAgent] Error for case {case_data.id}: {str(e)}")
        return Diagnosis(
            failure_class=FailureClass.UNKNOWN,
            confidence=0.0,
            reasoning='agent_error_fallback'
        )

def validate_diagnosis(result: dict) -> Diagnosis:
    failure_class = result.get('failure_class')
    confidence = result.get('confidence')
    reasoning = result.get('reasoning')

    if failure_class not in VALID_FAILURE_CLASSES:
        failure_class = 'unknown'

    if not isinstance(confidence, (int, float)):
        confidence = 0.0
    confidence = max(0.0, min(1.0, float(confidence)))

    if not isinstance(reasoning, str) or not reasoning:
        reasoning = 'No reasoning provided'

    return Diagnosis(
        failure_class=FailureClass(failure_class),
        confidence=confidence,
        reasoning=reasoning
    )
