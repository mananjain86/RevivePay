import logging
import random
from typing import Tuple, Dict, Any, List
from datetime import datetime, timezone
from app.models.bandit_arm import BanditArm
from app.models.case import FailureClass

logger = logging.getLogger(__name__)

# Base parameters
INITIAL_EPSILON = 0.4
MIN_EPSILON = 0.05
DECAY_RATE = 0.95

# Available actions (arms)
BANDIT_ACTIONS = [
    'CREATE_PAYMENT_LINK',
    'SEND_REMINDER',
    'OFFER_DISCOUNT_3',
    'OFFER_DISCOUNT_5',
    'OFFER_DISCOUNT_8',
    'ESCALATE_TO_HUMAN'
]

async def _get_or_create_arms(failure_class: str) -> List[BanditArm]:
    arms = await BanditArm.find({"failure_class": failure_class}).to_list()
    if not arms or len(arms) < len(BANDIT_ACTIONS):
        existing_actions = {arm.action for arm in arms}
        new_arms = []
        for action in BANDIT_ACTIONS:
            if action not in existing_actions:
                new_arm = BanditArm(
                    failure_class=failure_class,
                    action=action
                )
                new_arms.append(new_arm)
        
        if new_arms:
            await BanditArm.insert_many(new_arms)
            arms.extend(new_arms)
            
    return arms

def _calculate_epsilon(total_trials: int) -> float:
    """Calculates decayed epsilon: max(MIN_EPSILON, INITIAL_EPSILON * (DECAY_RATE ^ trials))"""
    if total_trials == 0:
        return INITIAL_EPSILON
    decayed = INITIAL_EPSILON * (DECAY_RATE ** total_trials)
    return max(MIN_EPSILON, decayed)

async def select_action(failure_class_enum: FailureClass, epsilon_override: float = None) -> Tuple[str, bool, float]:
    """
    Selects an action using Epsilon-Greedy.
    Returns: (action_name, was_exploration, avg_reward_at_time)
    """
    failure_class = failure_class_enum.value
    arms = await _get_or_create_arms(failure_class)
    
    total_trials = sum(arm.total_trials for arm in arms)
    epsilon = epsilon_override if epsilon_override is not None else _calculate_epsilon(total_trials)
    
    # Epsilon-Greedy selection
    if random.random() < epsilon:
        # Explore: Pick a random arm
        chosen_arm = random.choice(arms)
        was_exploration = True
        logger.info(f"[Bandit] EXPLORE: Selected {chosen_arm.action} for {failure_class}")
    else:
        # Exploit: Pick the arm with highest avg_reward
        chosen_arm = max(arms, key=lambda arm: arm.avg_reward)
        was_exploration = False
        logger.info(f"[Bandit] EXPLOIT: Selected {chosen_arm.action} for {failure_class}")
        
    return chosen_arm.action, was_exploration, chosen_arm.avg_reward

async def record_reward(failure_class_enum: FailureClass, action: str, reward: float):
    """
    Records the outcome of an action and updates the running average reward.
    reward should be normalized to [0, 1] ideally (net_recovered / amount).
    """
    failure_class = failure_class_enum.value
    
    # We shouldn't record for actions outside our space (like DO_NOT_CONTACT)
    if action not in BANDIT_ACTIONS:
        return
        
    arm = await BanditArm.find_one({"failure_class": failure_class, "action": action})
    if not arm:
        # Handle edge case where arm doesn't exist yet (shouldn't happen due to _get_or_create)
        arm = BanditArm(failure_class=failure_class, action=action)
        
    arm.total_trials += 1
    arm.total_reward += reward
    arm.avg_reward = arm.total_reward / arm.total_trials
    arm.last_updated = datetime.now(timezone.utc)
    
    await arm.save()
    logger.info(f"[Bandit] Reward recorded for {failure_class} -> {action}: {reward:.3f} (new avg: {arm.avg_reward:.3f})")

async def get_scoreboard() -> Dict[str, Any]:
    """Returns the full bandit state for the dashboard."""
    all_arms = await BanditArm.find_all().to_list()
    
    scoreboard = {}
    for arm in all_arms:
        if arm.failure_class not in scoreboard:
            scoreboard[arm.failure_class] = []
            
        scoreboard[arm.failure_class].append({
            "action": arm.action,
            "trials": arm.total_trials,
            "avg_reward": arm.avg_reward
        })
        
    # Sort actions within each failure class for consistent UI
    for fc in scoreboard:
        scoreboard[fc].sort(key=lambda x: x["avg_reward"], reverse=True)
        
    # Calculate global epsilon
    total_trials_overall = sum(arm.total_trials for arm in all_arms)
    current_epsilon = _calculate_epsilon(total_trials_overall) # Global avg approximation for UI
        
    return {
        "scoreboard": scoreboard,
        "config": {
            "initial_epsilon": INITIAL_EPSILON,
            "min_epsilon": MIN_EPSILON,
            "decay_rate": DECAY_RATE,
            "current_epsilon": current_epsilon,
            "total_trials": total_trials_overall
        }
    }

async def reset_bandit():
    """Wipes the bandit state."""
    await BanditArm.find_all().delete()
    logger.info("[Bandit] Scoreboard reset.")
