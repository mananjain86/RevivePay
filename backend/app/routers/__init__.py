from fastapi import APIRouter
from .cases import router as cases_router
from .approvals import router as approvals_router
from .jobs import router as jobs_router
from .webhooks import router as webhooks_router
from .sweep import router as sweep_router

api_router = APIRouter(prefix="/api")
api_router.include_router(cases_router)
api_router.include_router(approvals_router)
api_router.include_router(jobs_router)
api_router.include_router(webhooks_router)
api_router.include_router(sweep_router)
