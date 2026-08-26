import os
import asyncio
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from app.models.case import Case, CaseType, CaseStatus
from app.models.processed_webhook_event import ProcessedWebhookEvent

logger = logging.getLogger(__name__)

all_cases = [
    {
        "case_type": CaseType.FAILED_PAYMENT, "amount": 15000, "customer_id": 'sim-success-target',
        "is_repeat_buyer": True, "attempt_number": 1, "failure_reason_raw": 'High value UPI payment failed',
        "has_recovery_consent": True, "contact_count": 0, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    },
    {
        "case_type": CaseType.FAILED_PAYMENT, "amount": 5000, "customer_id": 'demo-stop',
        "is_repeat_buyer": False, "attempt_number": 3, "failure_reason_raw": 'Card declined - repeated failures',
        "has_recovery_consent": True, "contact_count": 1, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    },
    {
        "case_type": CaseType.ABANDONED_CHECKOUT, "amount": 8000, "customer_id": 'demo-human',
        "is_repeat_buyer": True, "attempt_number": 1, "failure_reason_raw": 'Cart abandoned at payment step, high value item',
        "has_recovery_consent": True, "contact_count": 0, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    },
    {
        "case_type": CaseType.FAILED_PAYMENT, "amount": 1200, "customer_id": 'edge-no-consent',
        "is_repeat_buyer": False, "attempt_number": 1, "failure_reason_raw": 'Customer denied recovery consent',
        "has_recovery_consent": False, "contact_count": 0, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    },
    {
        "case_type": CaseType.FAILED_PAYMENT, "amount": 99, "customer_id": 'edge-too-small',
        "is_repeat_buyer": False, "attempt_number": 1, "failure_reason_raw": 'Insufficient funds for low value item',
        "has_recovery_consent": True, "contact_count": 0, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    },
    {
        "case_type": CaseType.ABANDONED_CHECKOUT, "amount": 1000, "customer_id": 'edge-max-contact',
        "is_repeat_buyer": False, "attempt_number": 1, "failure_reason_raw": 'Abandoned cart',
        "has_recovery_consent": True, "contact_count": 2, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    },
    {
        "case_type": CaseType.FAILED_PAYMENT, "amount": 3500, "customer_id": 'demo-standard-2',
        "is_repeat_buyer": False, "attempt_number": 1, "failure_reason_raw": 'UPI timeout',
        "has_recovery_consent": True, "contact_count": 0, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    },
    {
        "case_type": CaseType.ABANDONED_CHECKOUT, "amount": 4500, "customer_id": 'demo-standard-3',
        "is_repeat_buyer": True, "attempt_number": 1, "failure_reason_raw": 'Distracted during checkout',
        "has_recovery_consent": True, "contact_count": 0, "max_contact_count": 2, "demo_case": True, "status": CaseStatus.NEW
    }
]

async def seed_data():
    uri = os.environ.get('MONGODB_URI')
    if not uri:
        print("[Seed] Error: MONGODB_URI not set")
        return
        
    import certifi
    client = AsyncIOMotorClient(uri, tlsCAFile=certifi.where())
    # the database name is typically in the URI, e.g., mongodb://localhost:27017/revivepay
    db = client.get_database('revivepay')
    
    await init_beanie(database=db, document_models=[Case, ProcessedWebhookEvent])
    
    print('[Seed] Connected to MongoDB')
    
    # Clear existing cases
    await Case.find_all().delete()
    print('[Seed] Cleared existing cases')
    
    # Insert all
    cases = [Case(**c) for c in all_cases]
    await Case.insert_many(cases)
    print(f'[Seed] Inserted {len(cases)} cases')
    
    # Summary
    consent_false = sum(1 for c in all_cases if not c['has_recovery_consent'])
    high_attempt = sum(1 for c in all_cases if c['attempt_number'] >= 3)
    at_contact_cap = sum(1 for c in all_cases if c['contact_count'] >= c['max_contact_count'])
    low_amount = sum(1 for c in all_cases if c['amount'] < 100)
    demos = sum(1 for c in all_cases if c['demo_case'])
    
    print(f'[Seed] Summary:')
    print(f'  Total: {len(all_cases)}')
    print(f'  Demo cases: {demos}')
    print(f'  No consent: {consent_false} (will be blocked)')
    print(f'  High attempt (>=3): {high_attempt} (will trigger stop rule)')
    print(f'  At contact cap: {at_contact_cap} (will trigger stop rule)')
    print(f'  Below ₹100: {low_amount} (will trigger minimum threshold)')
    print('[Seed] Done')

if __name__ == '__main__':
    from dotenv import load_dotenv
    load_dotenv()
    asyncio.run(seed_data())
