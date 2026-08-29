from app.models.case import Case, Plan, PolicyCheck, PolicyDecision

# ─── Runtime-Mutable Configuration ──────────────────────────────────────────
# These values can be hot-swapped at runtime via apply_thresholds() without
# restarting the server. The factory defaults are preserved for revert.

_FACTORY_DEFAULTS = {
    "max_attempts": 3,
    "min_recoverable_amount": 100,       # rupees
    "auto_approve_discount_max_pct": 0,
    "approval_discount_max_pct": 5,
    "min_confidence_auto_approve": 0.6,
}

_active_config = {**_FACTORY_DEFAULTS}
_previous_config = None  # Stored on apply for one-step revert
_applied_at = None       # ISO timestamp of last apply, None = factory defaults


def get_active_thresholds() -> dict:
    """Return the currently active threshold configuration."""
    return {
        **_active_config,
        "is_factory_defaults": _active_config == _FACTORY_DEFAULTS,
        "applied_at": _applied_at,
    }


def get_factory_defaults() -> dict:
    """Return the immutable factory default thresholds."""
    return {**_FACTORY_DEFAULTS}


def apply_thresholds(thresholds: dict) -> dict:
    """
    Overwrite the active policy config with new thresholds.
    Stores the previous config for one-step revert.
    Only updates keys that exist in the config; ignores unknown keys.
    """
    global _active_config, _previous_config, _applied_at
    from datetime import datetime, timezone

    _previous_config = {**_active_config}
    for key in _FACTORY_DEFAULTS:
        if key in thresholds:
            _active_config[key] = thresholds[key]

    _applied_at = datetime.now(timezone.utc).isoformat()
    return get_active_thresholds()


def revert_thresholds() -> dict:
    """
    Revert to the previous config (if one exists), otherwise to factory defaults.
    """
    global _active_config, _previous_config, _applied_at

    if _previous_config is not None:
        _active_config = {**_previous_config}
        _previous_config = None
    else:
        _active_config = {**_FACTORY_DEFAULTS}

    _applied_at = None
    return get_active_thresholds()


# ─── Policy Check ────────────────────────────────────────────────────────────

def check_policy(case_data: Case, plan: Plan) -> PolicyCheck:
    """
    Evaluate a case + plan against the currently active policy thresholds.
    """
    cfg = _active_config

    MAX_ATTEMPTS = cfg["max_attempts"]
    MIN_RECOVERABLE_AMOUNT = cfg["min_recoverable_amount"]
    AUTO_APPROVE_DISCOUNT_MAX_PCT = cfg["auto_approve_discount_max_pct"]
    APPROVAL_DISCOUNT_MAX_PCT = cfg["approval_discount_max_pct"]
    MIN_CONFIDENCE_AUTO_APPROVE = cfg["min_confidence_auto_approve"]

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

    # Rule 5: Any discount (above auto-approve ceiling) requires merchant approval
    if discount > AUTO_APPROVE_DISCOUNT_MAX_PCT and discount <= APPROVAL_DISCOUNT_MAX_PCT:
        return PolicyCheck(
            decision=PolicyDecision.NEEDS_MERCHANT_APPROVAL,
            reason=f'Any discount ({discount}%, range {AUTO_APPROVE_DISCOUNT_MAX_PCT}-{APPROVAL_DISCOUNT_MAX_PCT}%) requires merchant approval'
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
