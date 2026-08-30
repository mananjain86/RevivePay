from fastapi import APIRouter, Query
from app.bandit.bandit_engine import get_scoreboard, reset_bandit
from app.bandit.ab_comparison import run_ab_comparison

router = APIRouter(prefix="/bandit", tags=["bandit"])

@router.get("/scoreboard")
async def get_bandit_scoreboard():
    """Returns the current state of all bandit arms and configuration."""
    return await get_scoreboard()

@router.post("/reset")
async def reset_bandit_state():
    """Wipes the bandit state (for demo/testing purposes)."""
    await reset_bandit()
    return {"status": "success", "message": "Bandit state has been reset."}

@router.post("/ab-comparison")
async def ab_comparison(
    num_cases: int = Query(200, ge=20, le=1000),
    batch_size: int = Query(20, ge=5, le=100),
    seed: int = Query(42),
):
    """
    Run a full A/B comparison: Fixed Rules vs. Bandit.
    Everything runs in-memory with simulated execution — no DB writes, no LLM calls.
    """
    return run_ab_comparison(num_cases=num_cases, batch_size=batch_size, seed=seed)

