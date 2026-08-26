from datetime import datetime, timezone
from pydantic import Field
from beanie import Document

class ProcessedWebhookEvent(Document):
    razorpay_event_id: str = Field(..., unique=True)
    processed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "processedwebhookevents" # To match Mongoose's pluralization, but Mongoose probably named it "processedwebhookevents". I'll use the default lowercase plural.

