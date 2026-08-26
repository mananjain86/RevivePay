from app.models.case import Case, Plan, PolicyCheck, PolicyDecision

MAX_ATTEMPTS = 3
MIN_RECOVERABLE_AMOUNT = 100 # rupees
AUTO_APPROVE_DISCOUNT_MAX_PCT = 0
APPROVAL_DISCOUNT_MAX_PCT = 5
MIN_CONFIDENCE_AUTO_APPROVE = 0.6

def check_policy(case_data: Case, plan: Plan) -> PolicyCheck:
    # Rule 1: Consent check
    if case_data.has_recovery_consent is False:
        return PolicyCheck(
            decision=PolicyDecision.BLOCKED_NO_CONSENT,
            reason='Customer has not consented to recovery contact'
        )
    
    # Rule 2: Retry/contact cap check
    if case_data.attempt_number >= MAX_ATTEMPTS or case_data.contact_count >= case_data.max_contact_count:
        return PolicyCheck(
            decision=PolicyDecision.BLOCKED_STOP_RULE,
            reason=f'Retry/contact cap reached (attempt {case_data.attempt_number}/{MAX_ATTEMPTS}, contacts {case_data.contact_count}/{case_data.max_contact_count})'
        )

    # Rule 3: Minimum amount threshold
    if case_data.amount < MIN_RECOVERABLE_AMOUNT:
        return PolicyCheck(
            decision=PolicyDecision.BLOCKED_STOP_RULE,
            reason=f'Amount ₹{case_data.amount} below minimum recovery threshold (₹{MIN_RECOVERABLE_AMOUNT})'
        )

    # Rule 4: Discount exceeds hard ceiling -> REJECTED with fallback
    discount = plan.discount_requested_pct or 0.0
    if discount > APPROVAL_DISCOUNT_MAX_PCT:
        return PolicyCheck(
            decision=PolicyDecision.REJECTED_FALLBACK,
            reason=f'Discount {discount}% exceeds maximum allowable ceiling ({APPROVAL_DISCOUNT_MAX_PCT}%)',
            fallback_action='CREATE_PAYMENT_LINK'
        )

    # Rule 5: Any discount (1-5%) requires merchant approval
    if discount > AUTO_APPROVE_DISCOUNT_MAX_PCT and discount <= APPROVAL_DISCOUNT_MAX_PCT:
        return PolicyCheck(
            decision=PolicyDecision.NEEDS_MERCHANT_APPROVAL,
            reason=f'Any discount ({discount}%, range 1-{APPROVAL_DISCOUNT_MAX_PCT}%) requires merchant approval'
        )

    # Rule 6: Low confidence requires merchant review
    confidence = plan.confidence or 0.0
    if confidence < MIN_CONFIDENCE_AUTO_APPROVE:
        return PolicyCheck(
            decision=PolicyDecision.NEEDS_MERCHANT_APPROVAL,
            reason=f'Planner confidence {confidence:.2f} below auto-approve threshold ({MIN_CONFIDENCE_AUTO_APPROVE})'
        )

    # Rule 7: All checks passed
    return PolicyCheck(
        decision=PolicyDecision.APPROVED,
        reason='Within policy limits'
    )
