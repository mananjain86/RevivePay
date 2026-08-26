import os
import json
import hmac
import hashlib
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Request, Header
from fastapi.responses import JSONResponse

from app.models.case import Case, CaseStatus, PaymentLinkStatus, AuditLogEntry
from app.models.processed_webhook_event import ProcessedWebhookEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

@router.post("/razorpay")
async def razorpay_webhook(
    request: Request,
    x_razorpay_signature: str = Header(None),
    x_razorpay_event_id: str = Header(None)
):
    try:
        logger.info("[Webhook] Received POST /api/webhooks/razorpay")
        
        # Read the raw body
        raw_body = await request.body()
        webhook_secret = os.environ.get('RAZORPAY_WEBHOOK_SECRET')

        if not x_razorpay_signature or not webhook_secret:
            logger.error(f"[Webhook] Missing data! Signature present: {bool(x_razorpay_signature)}, Secret present: {bool(webhook_secret)}")
            return JSONResponse(status_code=400, content={"error": "Missing signature or webhook secret"})

        # 1. Verify HMAC-SHA256 signature against raw body
        expected_signature = hmac.new(
            webhook_secret.encode('utf-8'),
            raw_body,
            hashlib.sha256
        ).hexdigest()

        if not hmac.compare_digest(expected_signature, x_razorpay_signature):
            logger.warning("[Webhook] Signature mismatch — rejecting")
            return JSONResponse(status_code=400, content={"error": "Invalid signature"})

        # Parse the verified raw body
        event = json.loads(raw_body.decode('utf-8'))

        if not x_razorpay_event_id:
            logger.error("[Webhook] Missing x-razorpay-event-id header!")
            return JSONResponse(status_code=400, content={"error": "Missing event ID"})

        # 2. Dedup check — prevent double-counting recovered revenue
        existing = await ProcessedWebhookEvent.find_one({"razorpay_event_id": x_razorpay_event_id})
        if existing:
            # Already processed — return 200 immediately without reprocessing
            return JSONResponse(status_code=200, content={"status": "already_processed"})

        # 3. Record this event as processed
        await ProcessedWebhookEvent(razorpay_event_id=x_razorpay_event_id).insert()

        # 4. Handle event types
        event_type = event.get('event')
        payload = event.get('payload', {})
        payment_link = payload.get('payment_link', {})
        payment_link_entity = payment_link.get('entity')

        if not payment_link_entity:
            return JSONResponse(status_code=200, content={"status": "no_payment_link_entity"})

        link_id = payment_link_entity.get('id')

        if event_type == 'payment_link.paid':
            case_doc = await Case.find_one({"execution.razorpay_reference": link_id})
            if case_doc:
                case_doc.execution.payment_link_status = PaymentLinkStatus.PAID
                case_doc.status = CaseStatus.RECOVERED
                case_doc.audit_log.append(AuditLogEntry(
                    stage='webhook_payment_confirmed',
                    timestamp=datetime.now(timezone.utc),
                    output={"event_type": event_type, "payment_link_id": link_id, "status": "recovered"}
                ))
                await case_doc.save()
                logger.info(f"[Webhook] Case {case_doc.id} → recovered (payment_link.paid)")
                
        elif event_type in ['payment_link.expired', 'payment_link.cancelled']:
            case_doc = await Case.find_one({"execution.razorpay_reference": link_id})
            if case_doc:
                p_status = PaymentLinkStatus.EXPIRED if event_type == 'payment_link.expired' else PaymentLinkStatus.CANCELLED
                case_doc.execution.payment_link_status = p_status
                case_doc.status = CaseStatus.UNRECOVERED_EXPIRED
                case_doc.audit_log.append(AuditLogEntry(
                    stage='webhook_payment_not_completed',
                    timestamp=datetime.now(timezone.utc),
                    output={"event_type": event_type, "payment_link_id": link_id, "status": "unrecovered_expired"}
                ))
                await case_doc.save()
                logger.info(f"[Webhook] Case {case_doc.id} → unrecovered_expired ({event_type})")

        # 5. Return 200 quickly
        return JSONResponse(status_code=200, content={"status": "processed"})

    except Exception as e:
        logger.error(f"[Webhook] Error processing webhook: {str(e)}")
        # Still return 200 to prevent Razorpay from retrying on our errors
        return JSONResponse(status_code=200, content={"status": "error", "message": str(e)})
