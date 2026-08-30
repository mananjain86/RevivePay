"""
A/B Comparison Engine
=====================
Runs the exact same batch of synthetic cases through two strategies:
  1. Fixed Rules — a static mapping of failure_class → action
  2. Bandit (ε-greedy) — learns from outcomes as it processes cases

Both use the same seeded-random simulation for determinism, so the only
variable is which action each strategy picks.  The result is a provable,
apples-to-apples comparison of cumulative net recovery.
"""

import random
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from bson import ObjectId

from app.models.case import (
    Case, CaseType, Plan, Recommendation, FailureClass,
)
from app.sweep.sweep_engine import _simulate_execution

logger = logging.getLogger(__name__)

# ─── Fixed-Rule Baseline ────────────────────────────────────────────────────
# A plausible but deliberately sub-optimal static rulebook that a human
# might set up before the bandit exists.

FIXED_RULES: Dict[str, str] = {
    'insufficient_funds':   'CREATE_PAYMENT_LINK',
    'expired_card':         'SEND_REMINDER',
    'technical_decline':    'CREATE_PAYMENT_LINK',
    'bank_error':           'ESCALATE_TO_HUMAN',
    'checkout_abandoned':   'SEND_REMINDER',
    'unknown':              'ESCALATE_TO_HUMAN',
}

# ─── Bandit Actions ─────────────────────────────────────────────────────────

BANDIT_ACTIONS = [
    'CREATE_PAYMENT_LINK',
    'SEND_REMINDER',
    'OFFER_DISCOUNT_3',
    'OFFER_DISCOUNT_5',
    'OFFER_DISCOUNT_8',
    'ESCALATE_TO_HUMAN',
]

# ─── In-Memory Bandit (no DB) ───────────────────────────────────────────────

class InMemoryBandit:
    """A pure-Python epsilon-greedy bandit that lives entirely in RAM."""

    def __init__(
        self,
        actions: List[str],
        failure_classes: List[str],
        initial_epsilon: float = 0.4,
        min_epsilon: float = 0.05,
        decay_rate: float = 0.95,
    ):
        self.actions = actions
        self.initial_epsilon = initial_epsilon
        self.min_epsilon = min_epsilon
        self.decay_rate = decay_rate
        # arms[failure_class][action] = {trials, total_reward, avg_reward}
        self.arms: Dict[str, Dict[str, Dict]] = {}
        for fc in failure_classes:
            self.arms[fc] = {
                a: {"trials": 0, "total_reward": 0.0, "avg_reward": 0.0}
                for a in actions
            }

    def _epsilon(self, fc: str) -> float:
        total = sum(arm["trials"] for arm in self.arms[fc].values())
        if total == 0:
            return self.initial_epsilon
        return max(self.min_epsilon, self.initial_epsilon * (self.decay_rate ** total))

    def select(self, fc: str, rng: random.Random) -> str:
        eps = self._epsilon(fc)
        if rng.random() < eps:
            return rng.choice(self.actions)
        # Exploit: pick best avg_reward (ties broken randomly)
        best_reward = max(arm["avg_reward"] for arm in self.arms[fc].values())
        best_actions = [a for a, arm in self.arms[fc].items() if arm["avg_reward"] == best_reward]
        return rng.choice(best_actions)

    def record(self, fc: str, action: str, reward: float):
        arm = self.arms[fc][action]
        arm["trials"] += 1
        arm["total_reward"] += reward
        arm["avg_reward"] = arm["total_reward"] / arm["trials"]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _action_to_plan(action: str) -> Plan:
    """Create a Plan object from a raw action string."""
    discount_pct = 0.0
    if action == 'OFFER_DISCOUNT_3':
        discount_pct = 3.0
    elif action == 'OFFER_DISCOUNT_5':
        discount_pct = 5.0
    elif action == 'OFFER_DISCOUNT_8':
        discount_pct = 8.0

    return Plan(
        recommendation=Recommendation(action),
        confidence=0.7,
        discount_requested_pct=discount_pct,
        reasoning="A/B comparison simulation",
    )


class SyntheticCase:
    """Lightweight stand-in for Case — no Beanie, no MongoDB."""
    def __init__(self, id, amount, failure_reason_raw, contact_count=0):
        self.id = id
        self.amount = amount
        self.failure_reason_raw = failure_reason_raw
        self.contact_count = contact_count


def _generate_synthetic_cases(
    total: int = 200,
    seed: int = 42,
) -> List[SyntheticCase]:
    """Generate a deterministic pool of synthetic cases."""
    gen = random.Random(seed)
    fc_values = [fc.value for fc in FailureClass]
    amounts = [500, 1200, 2500, 5000, 8000, 12000, 15000, 20000, 30000, 50000]

    cases: List[SyntheticCase] = []
    for i in range(total):
        fc = fc_values[i % len(fc_values)]
        amount = gen.choice(amounts)
        case = SyntheticCase(
            id=ObjectId(),
            amount=float(amount),
            failure_reason_raw=fc,
        )
        cases.append(case)
    return cases


# ─── Run A/B Comparison ─────────────────────────────────────────────────────

def run_ab_comparison(
    num_cases: int = 200,
    batch_size: int = 20,
    seed: int = 42,
) -> Dict[str, Any]:
    """
    Run the full A/B comparison:
      - Fixed Rules:  same action per failure class, every time.
      - Bandit:       ε-greedy learning across the batch.

    Returns a rich result dict with totals, per-failure breakdown,
    and per-batch cumulative data for a learning-curve chart.
    """
    cases = _generate_synthetic_cases(total=num_cases, seed=seed)

    fc_values = [fc.value for fc in FailureClass]
    bandit = InMemoryBandit(BANDIT_ACTIONS, fc_values)
    bandit_rng = random.Random(seed + 1)  # separate RNG for bandit decisions

    # ── Accumulators ─────────────────────────────────────────────────────
    fixed_total = {"gross": 0.0, "net": 0.0, "discount_cost": 0.0, "contact_cost": 0.0, "recovered": 0}
    bandit_total = {"gross": 0.0, "net": 0.0, "discount_cost": 0.0, "contact_cost": 0.0, "recovered": 0}

    fixed_by_fc: Dict[str, dict] = {fc: {"gross": 0.0, "net": 0.0, "recovered": 0, "total": 0} for fc in fc_values}
    bandit_by_fc: Dict[str, dict] = {fc: {"gross": 0.0, "net": 0.0, "recovered": 0, "total": 0} for fc in fc_values}

    # Per-batch cumulative data for the learning curve chart
    cumulative_fixed = []
    cumulative_bandit = []
    running_fixed_net = 0.0
    running_bandit_net = 0.0

    num_batches = (num_cases + batch_size - 1) // batch_size

    for batch_idx in range(num_batches):
        start = batch_idx * batch_size
        end = min(start + batch_size, num_cases)
        batch = cases[start:end]

        batch_fixed_net = 0.0
        batch_bandit_net = 0.0

        for case in batch:
            fc = case.failure_reason_raw  # we stored failure_class here

            # ── Fixed Rules ──────────────────────────────────────────
            fixed_action = FIXED_RULES.get(fc, 'CREATE_PAYMENT_LINK')
            fixed_plan = _action_to_plan(fixed_action)
            fixed_outcome = _simulate_execution(case, fixed_plan)

            if fixed_outcome["recovered"]:
                fixed_total["recovered"] += 1
                fixed_total["gross"] += fixed_outcome["gross_amount"]
                fixed_total["discount_cost"] += fixed_outcome["discount_cost"]
                fixed_by_fc[fc]["recovered"] += 1
                fixed_by_fc[fc]["gross"] += fixed_outcome["gross_amount"]

            fixed_total["contact_cost"] += fixed_outcome["contact_cost"]
            case_fixed_net = fixed_outcome["gross_amount"] - fixed_outcome["discount_cost"] - fixed_outcome["contact_cost"]
            fixed_total["net"] += case_fixed_net
            fixed_by_fc[fc]["net"] += case_fixed_net
            fixed_by_fc[fc]["total"] += 1

            batch_fixed_net += case_fixed_net

            # ── Bandit ───────────────────────────────────────────────
            bandit_action = bandit.select(fc, bandit_rng)
            bandit_plan = _action_to_plan(bandit_action)
            bandit_outcome = _simulate_execution(case, bandit_plan)

            if bandit_outcome["recovered"]:
                bandit_total["recovered"] += 1
                bandit_total["gross"] += bandit_outcome["gross_amount"]
                bandit_total["discount_cost"] += bandit_outcome["discount_cost"]
                bandit_by_fc[fc]["recovered"] += 1
                bandit_by_fc[fc]["gross"] += bandit_outcome["gross_amount"]

            bandit_total["contact_cost"] += bandit_outcome["contact_cost"]
            case_bandit_net = bandit_outcome["gross_amount"] - bandit_outcome["discount_cost"] - bandit_outcome["contact_cost"]
            bandit_total["net"] += case_bandit_net
            bandit_by_fc[fc]["net"] += case_bandit_net
            bandit_by_fc[fc]["total"] += 1

            batch_bandit_net += case_bandit_net

            # Record reward for bandit learning
            reward = max(0.0, case_bandit_net / case.amount) if case.amount > 0 else 0.0
            bandit.record(fc, bandit_action, reward)

        # Track cumulative
        running_fixed_net += batch_fixed_net
        running_bandit_net += batch_bandit_net

        cumulative_fixed.append(round(running_fixed_net, 2))
        cumulative_bandit.append(round(running_bandit_net, 2))

    # ── Assemble results ─────────────────────────────────────────────────
    improvement_net = bandit_total["net"] - fixed_total["net"]
    improvement_pct = (improvement_net / fixed_total["net"] * 100) if fixed_total["net"] > 0 else 0.0

    # Build per-failure-class comparison
    per_fc = []
    for fc in fc_values:
        f = fixed_by_fc[fc]
        b = bandit_by_fc[fc]
        delta = b["net"] - f["net"]
        per_fc.append({
            "failure_class": fc,
            "fixed_rule": FIXED_RULES.get(fc, "?"),
            "fixed_net": round(f["net"], 2),
            "fixed_recovered": f["recovered"],
            "fixed_total": f["total"],
            "bandit_net": round(b["net"], 2),
            "bandit_recovered": b["recovered"],
            "bandit_total": b["total"],
            "delta_net": round(delta, 2),
        })

    # Build final bandit scoreboard
    final_scoreboard = {}
    for fc in fc_values:
        arms_sorted = sorted(
            bandit.arms[fc].items(),
            key=lambda x: x[1]["avg_reward"],
            reverse=True,
        )
        final_scoreboard[fc] = [
            {"action": a, "trials": d["trials"], "avg_reward": round(d["avg_reward"], 4)}
            for a, d in arms_sorted
        ]

    return {
        "config": {
            "num_cases": num_cases,
            "batch_size": batch_size,
            "seed": seed,
            "fixed_rules": FIXED_RULES,
        },
        "fixed": {
            "gross_recovered": round(fixed_total["gross"], 2),
            "net_recovered": round(fixed_total["net"], 2),
            "discount_cost": round(fixed_total["discount_cost"], 2),
            "contact_cost": round(fixed_total["contact_cost"], 2),
            "cases_recovered": fixed_total["recovered"],
            "recovery_rate_pct": round(fixed_total["recovered"] / num_cases * 100, 1),
        },
        "bandit": {
            "gross_recovered": round(bandit_total["gross"], 2),
            "net_recovered": round(bandit_total["net"], 2),
            "discount_cost": round(bandit_total["discount_cost"], 2),
            "contact_cost": round(bandit_total["contact_cost"], 2),
            "cases_recovered": bandit_total["recovered"],
            "recovery_rate_pct": round(bandit_total["recovered"] / num_cases * 100, 1),
        },
        "improvement": {
            "net_delta": round(improvement_net, 2),
            "pct": round(improvement_pct, 1),
        },
        "learning_curve": {
            "batch_labels": [f"Batch {i+1}" for i in range(num_batches)],
            "fixed_cumulative": cumulative_fixed,
            "bandit_cumulative": cumulative_bandit,
        },
        "per_failure_class": per_fc,
        "bandit_scoreboard": final_scoreboard,
    }
