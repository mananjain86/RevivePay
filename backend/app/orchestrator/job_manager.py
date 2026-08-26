import uuid
import asyncio
import logging
from typing import Dict, Any

from app.models.case import Case, CaseStatus
from app.orchestrator.case_orchestrator import process_case

logger = logging.getLogger(__name__)

# In-memory job store
jobs: Dict[str, Dict[str, Any]] = {}

async def start_batch_job() -> str:
    job_id = f"job_{uuid.uuid4().hex[:8]}"
    
    # Count cases that need processing
    case_docs = await Case.find({"status": CaseStatus.NEW}).to_list()
    total = len(case_docs)
    
    if total == 0:
        jobs[job_id] = {"status": "completed", "total": 0, "completed": 0, "failed": 0, "skipped": 0}
        return job_id
        
    jobs[job_id] = {"status": "running", "total": total, "completed": 0, "failed": 0, "skipped": 0}
    
    # Start background task in asyncio
    asyncio.create_task(process_batch(job_id, [str(c.id) for c in case_docs]))
    
    return job_id

async def process_batch(job_id: str, case_ids: list):
    job = jobs.get(job_id)
    if not job:
        return
        
    for case_id in case_ids:
        try:
            result = await process_case(case_id)
            if result is None:
                job['skipped'] += 1
            else:
                job['completed'] += 1
        except Exception as e:
            job['failed'] += 1
            logger.error(f"[JobManager] Case failed: {str(e)}")
            
        # Delay between cases
        await asyncio.sleep(3.0)
        
    job['status'] = 'completed'
    logger.info(f"[JobManager] Batch {job_id} completed: {job['completed']} processed, {job['skipped']} skipped, {job['failed']} failed")

def get_job_status(job_id: str) -> dict:
    return jobs.get(job_id)
