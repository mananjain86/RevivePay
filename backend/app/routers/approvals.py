from fastapi import APIRouter, HTTPException
from app.orchestrator.case_orchestrator import resolve_approval

router = APIRouter(prefix="/approvals", tags=["approvals"])

@router.post("/{id}/approve")
async def approve_case(id: str):
    try:
        result = await resolve_approval(id, True)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{id}/reject")
async def reject_case(id: str):
    try:
        result = await resolve_approval(id, False)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
