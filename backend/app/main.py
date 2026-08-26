import os
import logging
from contextlib import asynccontextmanager
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

from app.models.case import Case
from app.models.processed_webhook_event import ProcessedWebhookEvent
from app.routers import api_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connect to MongoDB
    uri = os.environ.get('MONGODB_URI')
    if not uri:
        logger.error("[MongoDB] Connection failed: MONGODB_URI not set")
        yield
        return
    try:
        import certifi
        client = AsyncIOMotorClient(uri, tlsCAFile=certifi.where())
        db = client.get_database('revivepay')
        await init_beanie(database=db, document_models=[Case, ProcessedWebhookEvent])
        logger.info("[MongoDB] Connected successfully")
    except Exception as e:
        logger.error(f"[MongoDB] Connection failed: {str(e)}")
        
    yield
    # Cleanup if needed
    client.close()

app = FastAPI(title="RevivePay", lifespan=lifespan)

# Global middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(api_router)

# Health check
@app.get("/api/health")
async def health_check():
    return {"status": "ok", "project": "RevivePay — AI Recovery Desk for Payments at Risk"}

# Global error handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"[Server Error] {str(exc)}")
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "message": str(exc)}
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get('PORT', 5000))
    logger.info(f"[RevivePay] Server starting on port {port}")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
