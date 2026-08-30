"""
Threshold Sweep Engine
======================
Systematically evaluates every combination of policy-guard thresholds
against a batch of case snapshots, measuring net recovery for each.
Runs entirely in-memory — no DB writes, no LLM calls.
"""

import itertools
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

from app.models.case import (
    Case, Plan, PolicyCheck, PolicyDecision,
    CaseStatus, PaymentLinkStatus, Recommendation,
)
from app.utils.seeded_random import create_seeded_rng

logger = logging.getLogger(__name__)


# ─── Threshold Configuration ────────────────────────────────────────────────

@dataclass
class PolicyThresholds:
    """Bundle of the 5 tunable policy-guard parameters."""
    max_attempts: int = 3
    min_recoverable_amount: float = 100.0
    auto_approve_discount_max_pct: float = 0.0
    approval_discount_max_pct: float = 5.0
    min_confidence_auto_approve: float = 0.6
    label: str = "defaults"

    def to_dict(self) -> dict:
        return asdict(self)


FACTORY_DEFAULTS = PolicyThresholds(
    max_attempts=3,
    min_recoverable_amount=100.0,
    auto_approve_discount_max_pct=0.0,
    approval_discount_max_pct=8.0,
    min_confidence_auto_approve=0.6,
    label="factory_defaults",
)


# ─── Sweep Result ────────────────────────────────────────────────────────────

@dataclass
class SweepResult:
    """Metrics for one threshold combination evaluated against the full batch."""
    thresholds: PolicyThresholds
    gross_recovered: float = 0.0
    net_recovered: float = 0.0
    total_discount_cost: float = 0.0
    total_contact_cost: float = 0.0
    cases_recovered: int = 0
    cases_blocked: int = 0
    cases_no_consent: int = 0
    cases_needing_approval: int = 0
    cases_fallback: int = 0
    cases_unrecovered: int = 0
    total_cases: int = 0
    recovery_rate_pct: float = 0.0
    rank: int = 0

    def to_dict(self) -> dict:
        d = {
            "thresholds": self.thresholds.to_dict(),
            "gross_recovered": self.gross_recovered,
            "net_recovered": round(self.net_recovered, 2),
            "total_discount_cost": round(self.total_discount_cost, 2),
            "total_contact_cost": round(self.total_contact_cost, 2),
            "cases_recovered": self.cases_recovered,
            "cases_blocked": self.cases_blocked,
            "cases_no_consent": self.cases_no_consent,
            "cases_needing_approval": self.cases_needing_approval,
            "cases_fallback": self.cases_fallback,
            "cases_unrecovered": self.cases_unrecovered,
            "total_cases": self.total_cases,
            "recovery_rate_pct": round(self.recovery_rate_pct, 1),
            "rank": self.rank,
        }
        return d


@dataclass
class SweepReport:
    """Top-level report from a completed sweep run."""
    best: Optional[SweepResult] = None
    defaults: Optional[SweepResult] = None
    results: List[SweepResult] = field(default_factory=list)
    grid_size: int = 0
    total_cases: int = 0
    improvement_net: float = 0.0
    improvement_pct: float = 0.0
    timestamp: str = ""

    def to_dict(self) -> dict:
        return {
            "best": self.best.to_dict() if self.best else None,
            "defaults": self.defaults.to_dict() if self.defaults else None,
            "results": [r.to_dict() for r in self.results],
            "grid_size": self.grid_size,
            "total_cases": self.total_cases,
            "improvement_net": round(self.improvement_net, 2),
            "improvement_pct": round(self.improvement_pct, 1),
            "timestamp": self.timestamp,
        }


# ─── Grid Generation ────────────────────────────────────────────────────────

DEFAULT_CANDIDATES = {
    "max_attempts": [2, 3, 4, 5],
    "min_recoverable_amount": [50, 100, 200],
    "auto_approve_discount_max_pct": [0, 2, 5],
    "approval_discount_max_pct": [3, 5, 8, 10],
    "min_confidence_auto_approve": [0.4, 0.6],
}


def generate_sweep_grid(
    candidates: Optional[Dict[str, list]] = None,
) -> List[PolicyThresholds]:
    """Generate the cartesian product of all candidate threshold values."""
    c = candidates or DEFAULT_CANDIDATES

    combos = list(itertools.product(
        c["max_attempts"],
        c["min_recoverable_amount"],
        c["auto_approve_discount_max_pct"],
        c["approval_discount_max_pct"],
        c["min_confidence_auto_approve"],
    ))

    grid = []
    for (ma, mra, aadmp, admp, mcaa) in combos:
        # Skip invalid combos where auto-approve ceiling > hard ceiling
        if aadmp > admp:
            continue
        grid.append(PolicyThresholds(
            max_attempts=ma,
            min_recoverable_amount=mra,
            auto_approve_discount_max_pct=aadmp,
            approval_discount_max_pct=admp,
            min_confidence_auto_approve=mcaa,
            label=f"ma{ma}_mr{mra}_aa{aadmp}_ad{admp}_mc{mcaa}",
        ))

    logger.info(f"[Sweep] Generated grid with {len(grid)} valid combinations")
    return grid


# ─── Single-Case Simulation ─────────────────────────────────────────────────

def _check_policy_with_thresholds(
    case_data: Case, plan: Plan, t: PolicyThresholds
) -> PolicyCheck:
    """
    Pure-function reimplementation of check_policy using the given thresholds.
    Does not touch the live policy guard config.
    """
    # Rule 1: Consent check
    if case_data.has_recovery_consent is False:
        return PolicyCheck(
            decision=PolicyDecision.BLOCKED_NO_CONSENT,
            reason='No recovery consent'
        )

    # Rule 2: Retry/contact cap
    if case_data.attempt_number >= t.max_attempts or case_data.contact_count >= case_data.max_contact_count:
        return PolicyCheck(
            decision=PolicyDecision.BLOCKED_STOP_RULE,
            reason=f'Retry/contact cap (attempt {case_data.attempt_number}/{t.max_attempts})'
        )

    # Rule 3: Minimum amount
    if case_data.amount < t.min_recoverable_amount:
        return PolicyCheck(
            decision=PolicyDecision.BLOCKED_STOP_RULE,
            reason=f'Amount ₹{case_data.amount} below ₹{t.min_recoverable_amount}'
        )

    # Rule 4: Discount exceeds hard ceiling → fallback
    discount = plan.discount_requested_pct or 0.0
    if discount > t.approval_discount_max_pct:
        return PolicyCheck(
            decision=PolicyDecision.REJECTED_FALLBACK,
            reason=f'Discount {discount}% > ceiling {t.approval_discount_max_pct}%',
            fallback_action='CREATE_PAYMENT_LINK'
        )

    # Rule 5: Discount requires merchant approval
    if discount > t.auto_approve_discount_max_pct and discount <= t.approval_discount_max_pct:
        return PolicyCheck(
            decision=PolicyDecision.NEEDS_MERCHANT_APPROVAL,
            reason=f'Discount {discount}% needs approval (auto-approve ceiling {t.auto_approve_discount_max_pct}%)'
        )

    # Rule 6: Low confidence
    confidence = plan.confidence or 0.0
    if confidence < t.min_confidence_auto_approve:
        return PolicyCheck(
            decision=PolicyDecision.NEEDS_MERCHANT_APPROVAL,
            reason=f'Confidence {confidence:.2f} < {t.min_confidence_auto_approve}'
        )

    # Rule 7: All passed
    return PolicyCheck(
        decision=PolicyDecision.APPROVED,
        reason='Within policy limits'
    )


def _simulate_execution(case_data: Case, plan: Plan) -> dict:
    """
    Replay the simulated executor logic for a single case.
    Returns dict with recovered amount, costs, and outcome.
    Uses the same seeded RNG as the real executor for determinism.
    """
    rng = create_seeded_rng(str(case_data.id))
    recommendation = plan.recommendation.value if plan.recommendation else None

    recoverable_actions = (
        'CREATE_PAYMENT_LINK',
        'OFFER_DISCOUNT_3', 'OFFER_DISCOUNT_5', 'OFFER_DISCOUNT_8',
        # Legacy compat
        'OFFER_DISCOUNT',
    )

    if recommendation in recoverable_actions:
        payment_outcome = rng()

        discount_cost = 0.0
        discount_pct = plan.discount_requested_pct or 0.0
        if discount_pct > 0:
            discount_multiplier = 1.0 - (discount_pct / 100.0)
            final_amount = round(case_data.amount * discount_multiplier)
            discount_cost = case_data.amount - final_amount

        contact_cost = (case_data.contact_count + 1) * 2.0

        if payment_outcome < 0.65:
            return {
                "recovered": True,
                "gross_amount": case_data.amount,
                "discount_cost": discount_cost,
                "contact_cost": contact_cost,
                "status": "recovered",
            }
        else:
            return {
                "recovered": False,
                "gross_amount": 0.0,
                "discount_cost": 0.0,
                "contact_cost": contact_cost,
                "status": "unrecovered",
            }

    if recommendation == 'SEND_REMINDER':
        contact_cost = (case_data.contact_count + 1) * 2.0
        return {
            "recovered": False,
            "gross_amount": 0.0,
            "discount_cost": 0.0,
            "contact_cost": contact_cost,
            "status": "reminder_sent",
        }

    # DO_NOT_CONTACT or ESCALATE_TO_HUMAN
    return {
        "recovered": False,
        "gross_amount": 0.0,
        "discount_cost": 0.0,
        "contact_cost": 0.0,
        "status": "no_action",
    }


def simulate_single_case(case_data: Case, plan: Plan, t: PolicyThresholds) -> dict:
    """
    Replay the full policy → execution pipeline for one case
    under the given thresholds. Auto-approves merchant-approval cases.
    """
    policy = _check_policy_with_thresholds(case_data, plan, t)
    decision = policy.decision.value if policy.decision else ''

    if decision == 'APPROVED':
        result = _simulate_execution(case_data, plan)
        result["policy_decision"] = "APPROVED"
        return result

    if decision == 'NEEDS_MERCHANT_APPROVAL':
        # Auto-approve for sweep purposes
        result = _simulate_execution(case_data, plan)
        result["policy_decision"] = "NEEDS_MERCHANT_APPROVAL"
        return result

    if decision == 'REJECTED_FALLBACK':
        # Try fallback plan (payment link with no discount)
        fallback_plan = Plan(
            recommendation=Recommendation.CREATE_PAYMENT_LINK,
            discount_requested_pct=0.0,
            confidence=plan.confidence,
            reasoning="Fallback from sweep simulation",
        )
        fallback_policy = _check_policy_with_thresholds(case_data, fallback_plan, t)
        fb_decision = fallback_policy.decision.value if fallback_policy.decision else ''

        if fb_decision in ('APPROVED', 'NEEDS_MERCHANT_APPROVAL'):
            result = _simulate_execution(case_data, fallback_plan)
            result["policy_decision"] = f"REJECTED_FALLBACK→{fb_decision}"
            return result

        return {
            "recovered": False,
            "gross_amount": 0.0,
            "discount_cost": 0.0,
            "contact_cost": 0.0,
            "status": "blocked_after_fallback",
            "policy_decision": "REJECTED_FALLBACK→BLOCKED",
        }

    # BLOCKED_STOP_RULE or BLOCKED_NO_CONSENT
    return {
        "recovered": False,
        "gross_amount": 0.0,
        "discount_cost": 0.0,
        "contact_cost": 0.0,
        "status": "blocked",
        "policy_decision": decision,
    }


# ─── Full Sweep ──────────────────────────────────────────────────────────────

def run_sweep(
    case_snapshots: List[Case],
    grid: Optional[List[PolicyThresholds]] = None,
) -> SweepReport:
    """
    Run the full sweep: evaluate every threshold combination against
    every case snapshot. Returns a SweepReport sorted by net_recovered desc.
    """
    if grid is None:
        grid = generate_sweep_grid()

    total_cases = len(case_snapshots)
    results: List[SweepResult] = []
    defaults_result: Optional[SweepResult] = None

    for thresholds in grid:
        sr = SweepResult(thresholds=thresholds, total_cases=total_cases)

        for case in case_snapshots:
            plan = case.plan
            if not plan:
                continue

            outcome = simulate_single_case(case, plan, thresholds)

            if outcome["recovered"]:
                sr.cases_recovered += 1
                sr.gross_recovered += outcome["gross_amount"]
                sr.total_discount_cost += outcome["discount_cost"]

            sr.total_contact_cost += outcome["contact_cost"]

            pd = outcome.get("policy_decision", "")
            if "BLOCKED" in pd or pd in ("BLOCKED_STOP_RULE", "BLOCKED_NO_CONSENT"):
                sr.cases_blocked += 1
            if pd == "BLOCKED_NO_CONSENT":
                sr.cases_no_consent += 1
            if "NEEDS_MERCHANT_APPROVAL" in pd:
                sr.cases_needing_approval += 1
            if "REJECTED_FALLBACK" in pd:
                sr.cases_fallback += 1
            if not outcome["recovered"] and "BLOCKED" not in pd:
                sr.cases_unrecovered += 1

        sr.net_recovered = sr.gross_recovered - sr.total_discount_cost - sr.total_contact_cost
        sr.recovery_rate_pct = (sr.cases_recovered / total_cases * 100) if total_cases > 0 else 0.0

        results.append(sr)

        # Track the factory defaults result
        if (thresholds.max_attempts == FACTORY_DEFAULTS.max_attempts and
            thresholds.min_recoverable_amount == FACTORY_DEFAULTS.min_recoverable_amount and
            thresholds.auto_approve_discount_max_pct == FACTORY_DEFAULTS.auto_approve_discount_max_pct and
            thresholds.approval_discount_max_pct == FACTORY_DEFAULTS.approval_discount_max_pct and
            thresholds.min_confidence_auto_approve == FACTORY_DEFAULTS.min_confidence_auto_approve):
            defaults_result = sr

    # Sort by net_recovered descending
    results.sort(key=lambda r: r.net_recovered, reverse=True)

    # Assign ranks
    for i, r in enumerate(results):
        r.rank = i + 1

    best = results[0] if results else None

    # Compute improvement
    improvement_net = 0.0
    improvement_pct = 0.0
    if best and defaults_result:
        improvement_net = best.net_recovered - defaults_result.net_recovered
        if defaults_result.net_recovered > 0:
            improvement_pct = (improvement_net / defaults_result.net_recovered) * 100
        elif best.net_recovered > 0:
            improvement_pct = 100.0

    report = SweepReport(
        best=best,
        defaults=defaults_result,
        results=results,
        grid_size=len(grid),
        total_cases=total_cases,
        improvement_net=improvement_net,
        improvement_pct=improvement_pct,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    logger.info(
        f"[Sweep] Complete: {len(grid)} combos × {total_cases} cases. "
        f"Best net=₹{best.net_recovered:.0f} (rank 1), "
        f"Defaults net=₹{defaults_result.net_recovered:.0f} (rank {defaults_result.rank}). "
        f"Improvement: ₹{improvement_net:.0f} ({improvement_pct:.1f}%)"
        if best and defaults_result else "[Sweep] Complete (no results)"
    )

    return report


# ─── CLI Test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    """Quick self-test: generate grid and print stats."""
    grid = generate_sweep_grid()
    print(f"Grid size: {len(grid)} combinations")
    print(f"First: {grid[0].to_dict()}")
    print(f"Last:  {grid[-1].to_dict()}")

    # Check that factory defaults are in the grid
    has_defaults = any(
        t.max_attempts == 3 and t.min_recoverable_amount == 100 and
        t.auto_approve_discount_max_pct == 0 and t.approval_discount_max_pct == 8.0 and
        t.min_confidence_auto_approve == 0.6
        for t in grid
    )
    print(f"Factory defaults in grid: {has_defaults}")
