demo_fixtures = {
    # ─── Case A: Clean automated recovery ───────────────────────────
    'demo-clean': {
        "diagnosis": {
            "failure_class": "technical_decline",
            "confidence": 0.85,
            "reasoning": "Temporary UPI/bank failure, likely transient. The payment failed due to a bank-side timeout, which is typically resolved on retry."
        },
        "value_assessment": {
            "priority": "high",
            "cart_value": 2499,
            "is_repeat_buyer": True,
            "attempt_number": 1
        },
        "plan": {
            "recommendation": "CREATE_PAYMENT_LINK",
            "reasoning": "High-value repeat customer with a transient failure on first attempt. A fresh payment link allows easy retry with no discount needed.",
            "confidence": 0.88,
            "discount_requested_pct": 0
        }
    },
    # ─── Case B: Safe stop ──────────────────────────────────────────
    'demo-stop': {
        "diagnosis": {
            "failure_class": "bank_error",
            "confidence": 0.72,
            "reasoning": "Repeated card decline failures across 3 attempts suggest a hard decline — the card may be blocked, cancelled, or flagged by the issuing bank."
        },
        "value_assessment": {
            "priority": "medium",
            "cart_value": 5000,
            "is_repeat_buyer": False,
            "attempt_number": 3
        },
        "plan": {
            "recommendation": "SEND_REMINDER",
            "reasoning": "Suggest the customer try a different payment method via a reminder message.",
            "confidence": 0.65,
            "discount_requested_pct": 0
        }
    },
    # ─── Case C: Human-gated escalation (discount needs approval) ──
    'demo-human': {
        "diagnosis": {
            "failure_class": "checkout_abandoned",
            "confidence": 0.90,
            "reasoning": "Customer abandoned a high-value cart at the payment step. This is a classic hesitation-based abandonment, not a technical failure."
        },
        "value_assessment": {
            "priority": "high",
            "cart_value": 8000,
            "is_repeat_buyer": True,
            "attempt_number": 1
        },
        "plan": {
            "recommendation": "OFFER_DISCOUNT",
            "reasoning": "High-value abandoned cart from a repeat customer. A small incentive discount can overcome payment hesitation and recover this revenue.",
            "confidence": 0.82,
            "discount_requested_pct": 3
        }
    }
}
