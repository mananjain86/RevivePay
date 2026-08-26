from fastapi import APIRouter, HTTPException, Query
from typing import List, Optional
from app.models.case import Case, CaseStatus
from app.models.processed_webhook_event import ProcessedWebhookEvent
from app.orchestrator.job_manager import start_batch_job

router = APIRouter(prefix="/cases", tags=["cases"])

@router.get("")
async def get_cases(status: Optional[CaseStatus] = None):
    try:
        query = {}
        if status:
            query["status"] = status
        
        # Sort by updated_at (which is equivalent to id in terms of creation time, but beanie has `id` auto sorted or we can use sort)
        cases = await Case.find(query).sort("-id").to_list()
        return cases
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary")
async def get_cases_summary():
    try:
        all_cases = await Case.find_all().to_list()
        
        simulated = [c for c in all_cases if not c.demo_case or (c.execution and c.execution.executor_type.value == 'simulated')]
        real = [c for c in all_cases if c.demo_case and (c.execution and c.execution.executor_type.value == 'razorpay')]

        total_at_risk = sum(c.amount for c in all_cases)

        sim_recovered = sum(c.amount for c in simulated if c.status.value == 'recovered')
        sim_at_risk = sum(c.amount for c in simulated)
        sim_net_recovered = sim_recovered - sum((c.discount_cost or 0) for c in simulated if c.status.value == 'recovered') - sum((c.contact_cost or 0) for c in simulated)

        real_recovered = sum(c.amount for c in real if c.status.value == 'recovered')
        real_total = len(real)
        real_paid = len([c for c in real if c.status.value == 'recovered'])
        real_net_recovered = real_recovered - sum((c.discount_cost or 0) for c in real if c.status.value == 'recovered') - sum((c.contact_cost or 0) for c in real)

        status_counts = {}
        for c in all_cases:
            status = c.status.value if c.status else 'new'
            status_counts[status] = status_counts.get(status, 0) + 1

        return {
            "total_cases": len(all_cases),
            "total_at_risk": total_at_risk,
            "simulated": {
                "at_risk": sim_at_risk,
                "recovered": sim_recovered,
                "net_recovered": sim_net_recovered,
                "case_count": len(simulated),
                "recovery_rate": f"{((sim_recovered / sim_at_risk) * 100):.1f}" if sim_at_risk > 0 else "0.0"
            },
            "verified": {
                "recovered": real_recovered,
                "net_recovered": real_net_recovered,
                "total_demo_cases": real_total,
                "paid_count": real_paid
            },
            "status_counts": status_counts
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{id}")
async def get_case(id: str):
    from bson import ObjectId
    try:
        case_doc = await Case.get(ObjectId(id))
        if not case_doc:
            raise HTTPException(status_code=404, detail="Case not found")
        return case_doc
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/run-batch")
async def run_batch():
    try:
        job_id = await start_batch_job()
        return {"jobId": job_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reset")
async def reset_cases():
    from beanie.odm.operators.update.general import Set
    try:
        # Reset all cases
        result = await Case.find_all().update(
            Set({
                Case.status: CaseStatus.NEW,
                Case.diagnosis: None,
                Case.value_assessment: None,
                Case.plan: None,
                Case.policy_check: None,
                Case.fallback_policy_check: None,
                Case.execution: None,
                Case.audit_log: [],
                Case.contact_count: 0
            })
        )
        
        # Clear webhook events
        await ProcessedWebhookEvent.find_all().delete()
        
        return {
            "success": True,
            "reset_count": result.modified_count if result else 0, # Note: beanie update returns UpdateResult usually
            "message": "All cases reset to new status"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
