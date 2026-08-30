from datetime import datetime, timezone
from beanie import Document
from pydantic import Field

class BanditArm(Document):
    failure_class: str
    action: str
    total_trials: int = 0
    total_reward: float = 0.0
    avg_reward: float = 0.0
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    class Settings:
        name = "bandit_arms"
        use_state_management = True
