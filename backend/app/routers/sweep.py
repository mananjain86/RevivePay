import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any

from app.models.case import Case, CaseStatus
from app.sweep.sweep_engine import run_sweep, generate_sweep_grid, PolicyThresholds, FACTORY_DEFAULTS
from app.policy.policy_guard import (
    get_active_thresholds,
    get_factory_defaults,
    apply_thresholds,
    revert_thresholds,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sweep", tags=["sweep"])

# ─── In-Memory Cache ─────────────────────────────────────────────────────────
_last_report: Optional[dict] = None
_pre_apply_summary: Optional[dict] = None  # Summary snapshot taken before applying


class ApplyRequest(BaseModel):
    max_attempts: Optional[int] = None
    min_recoverable_amount: Optional[float] = None
    auto_approve_discount_max_pct: Optional[float] = None
    approval_discount_max_pct: Optional[float] = None
    min_confidence_auto_approve: Optional[float] = None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/run")
async def run_sweep_endpoint():
    """
    Fetch all cases that have a plan, snapshot them, run the full sweep grid,
    and return the SweepReport.
    """
    global _last_report

    try:
        # Fetch cases that have been through the pipeline (have a plan)
        eligible_statuses = [
            CaseStatus.PLANNED, CaseStatus.POLICY_CHECKED,
            CaseStatus.APPROVED, CaseStatus.NEEDS_MERCHANT_APPROVAL,
            CaseStatus.LINK_CREATED, CaseStatus.AWAITING_PAYMENT,
            CaseStatus.RECOVERED, CaseStatus.UNRECOVERED_EXPIRED,
            CaseStatus.EXECUTION_FAILED, CaseStatus.STOPPED_SAFELY,
            CaseStatus.BLOCKED_NO_CONSENT, CaseStatus.BLOCKED_STOP_RULE,
        ]

        cases = []
        for status in eligible_statuses:
            batch = await Case.find({"status": status}).to_list()
            cases.extend(batch)

        # Filter to only cases that actually have a plan
        cases_with_plans = [c for c in cases if c.plan is not None]

        if not cases_with_plans:
            raise HTTPException(
                status_code=400,
                detail="No cases with plans found. Run a batch first so cases have stored plans."
            )

        logger.info(f"[Sweep API] Running sweep with {len(cases_with_plans)} cases")

        grid = generate_sweep_grid()
        report = run_sweep(cases_with_plans, grid)
        _last_report = report.to_dict()

        return _last_report

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Sweep API] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/results")
async def get_sweep_results():
    """Return the most recent cached sweep report."""
    if _last_report is None:
        raise HTTPException(status_code=404, detail="No sweep results available. Run a sweep first.")
    return _last_report


@router.post("/apply")
async def apply_sweep_thresholds(request: ApplyRequest):
    """
    Apply the given threshold set to the live policy guard.
    Stores the previous config for revert.
    """
    global _pre_apply_summary

    try:
        # Snapshot the current summary before applying (for before/after comparison)
        from app.routers.cases import get_cases_summary
        try:
            _pre_apply_summary = await get_cases_summary()
        except Exception:
            _pre_apply_summary = None

        thresholds = {}
        if request.max_attempts is not None:
            thresholds["max_attempts"] = request.max_attempts
        if request.min_recoverable_amount is not None:
            thresholds["min_recoverable_amount"] = request.min_recoverable_amount
        if request.auto_approve_discount_max_pct is not None:
            thresholds["auto_approve_discount_max_pct"] = request.auto_approve_discount_max_pct
        if request.approval_discount_max_pct is not None:
            thresholds["approval_discount_max_pct"] = request.approval_discount_max_pct
        if request.min_confidence_auto_approve is not None:
            thresholds["min_confidence_auto_approve"] = request.min_confidence_auto_approve

        if not thresholds:
            raise HTTPException(status_code=400, detail="No thresholds provided")

        previous = get_active_thresholds()
        new_config = apply_thresholds(thresholds)

        logger.info(f"[Sweep API] Applied thresholds: {thresholds}")

        return {
            "success": True,
            "previous_config": previous,
            "active_config": new_config,
            "pre_apply_summary": _pre_apply_summary,
            "message": "Thresholds applied. Reset cases and run a new batch to see the effect."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Sweep API] Apply error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/revert")
async def revert_sweep_thresholds():
    """Revert to previous or factory-default thresholds."""
    try:
        new_config = revert_thresholds()
        logger.info("[Sweep API] Reverted thresholds")
        return {
            "success": True,
            "active_config": new_config,
            "message": "Thresholds reverted to previous/factory defaults."
        }
    except Exception as e:
        logger.error(f"[Sweep API] Revert error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active-config")
async def get_active_config():
    """Return the currently active threshold configuration."""
    return get_active_thresholds()


@router.get("/pre-apply-summary")
async def get_pre_apply_summary():
    """Return the summary snapshot taken before the last apply, for before/after comparison."""
    if _pre_apply_summary is None:
        raise HTTPException(status_code=404, detail="No pre-apply summary available.")
    return _pre_apply_summary
