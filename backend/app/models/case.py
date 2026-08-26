from datetime import datetime, timezone
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field
from beanie import Document
from enum import Enum

class CaseType(str, Enum):
    FAILED_PAYMENT = 'failed_payment'
    ABANDONED_CHECKOUT = 'abandoned_checkout'

class CaseStatus(str, Enum):
    NEW = 'new'
    PROCESSING = 'processing'
    DIAGNOSED = 'diagnosed'
    VALUED = 'valued'
    PLANNED = 'planned'
    POLICY_CHECKED = 'policy_checked'
    APPROVED = 'approved'
    NEEDS_MERCHANT_APPROVAL = 'needs_merchant_approval'
    LINK_CREATED = 'link_created'
    AWAITING_PAYMENT = 'awaiting_payment'
    RECOVERED = 'recovered'
    UNRECOVERED_EXPIRED = 'unrecovered_expired'
    EXECUTION_FAILED = 'execution_failed'
    BLOCKED_STOP_RULE = 'blocked_stop_rule'
    STOPPED_SAFELY = 'stopped_safely'
    BLOCKED_NO_CONSENT = 'blocked_no_consent'

class FailureClass(str, Enum):
    INSUFFICIENT_FUNDS = 'insufficient_funds'
    EXPIRED_CARD = 'expired_card'
    TECHNICAL_DECLINE = 'technical_decline'
    BANK_ERROR = 'bank_error'
    CHECKOUT_ABANDONED = 'checkout_abandoned'
    UNKNOWN = 'unknown'

class Diagnosis(BaseModel):
    failure_class: Optional[FailureClass] = None
    confidence: Optional[float] = Field(None, ge=0, le=1)
    reasoning: Optional[str] = None

class Priority(str, Enum):
    HIGH = 'high'
    MEDIUM = 'medium'
    LOW = 'low'

class ValueAssessment(BaseModel):
    priority: Optional[Priority] = None
    cart_value: Optional[float] = None
    is_repeat_buyer: Optional[bool] = None
    attempt_number: Optional[int] = None

class Recommendation(str, Enum):
    CREATE_PAYMENT_LINK = 'CREATE_PAYMENT_LINK'
    SEND_REMINDER = 'SEND_REMINDER'
    OFFER_DISCOUNT = 'OFFER_DISCOUNT'
    ESCALATE_TO_HUMAN = 'ESCALATE_TO_HUMAN'
    DO_NOT_CONTACT = 'DO_NOT_CONTACT'

class Plan(BaseModel):
    recommendation: Optional[Recommendation] = None
    reasoning: Optional[str] = None
    confidence: Optional[float] = Field(None, ge=0, le=1)
    discount_requested_pct: Optional[float] = Field(0, ge=0, le=100)

class PolicyDecision(str, Enum):
    APPROVED = 'APPROVED'
    REJECTED_FALLBACK = 'REJECTED_FALLBACK'
    NEEDS_MERCHANT_APPROVAL = 'NEEDS_MERCHANT_APPROVAL'
    BLOCKED_STOP_RULE = 'BLOCKED_STOP_RULE'
    BLOCKED_NO_CONSENT = 'BLOCKED_NO_CONSENT'

class PolicyCheck(BaseModel):
    decision: Optional[PolicyDecision] = None
    reason: Optional[str] = None
    fallback_action: Optional[str] = None

class FallbackPolicyDecision(str, Enum):
    APPROVED = 'APPROVED'
    NEEDS_MERCHANT_APPROVAL = 'NEEDS_MERCHANT_APPROVAL'
    BLOCKED_STOP_RULE = 'BLOCKED_STOP_RULE'

class FallbackPolicyCheck(BaseModel):
    decision: Optional[FallbackPolicyDecision] = None
    reason: Optional[str] = None

class MerchantApproval(BaseModel):
    required: bool = False
    approved_by_merchant: Optional[bool] = None
    approved_at: Optional[datetime] = None

class ExecutorType(str, Enum):
    SIMULATED = 'simulated'
    RAZORPAY = 'razorpay'

class ExecutionResult(str, Enum):
    SUCCESS = 'success'
    FAILURE = 'failure'
    NOT_ATTEMPTED = 'not_attempted'

class PaymentLinkStatus(str, Enum):
    CREATED = 'created'
    PAID = 'paid'
    EXPIRED = 'expired'
    CANCELLED = 'cancelled'

class Execution(BaseModel):
    executor_type: ExecutorType = ExecutorType.SIMULATED
    action_taken: Optional[str] = None
    result: ExecutionResult = ExecutionResult.NOT_ATTEMPTED
    razorpay_reference: Optional[str] = None
    payment_link_status: Optional[PaymentLinkStatus] = None
    timestamp: Optional[datetime] = None
    agent_errors: List[str] = Field(default_factory=list)

class AuditLogEntry(BaseModel):
    stage: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    output: Optional[Any] = None

class Case(Document):
    case_type: CaseType
    amount: float
    currency: str = 'INR'
    customer_id: str
    is_repeat_buyer: bool = False
    attempt_number: int = 1
    failure_reason_raw: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    has_recovery_consent: bool = False
    contact_count: int = 0
    last_contacted_at: Optional[datetime] = None
    max_contact_count: int = 2

    # Costs for net recovery calculation
    discount_cost: float = 0.0
    contact_cost: float = 0.0

    status: CaseStatus = CaseStatus.NEW

    diagnosis: Optional[Diagnosis] = None
    value_assessment: Optional[ValueAssessment] = None
    plan: Optional[Plan] = None
    policy_check: Optional[PolicyCheck] = None
    fallback_policy_check: Optional[FallbackPolicyCheck] = None
    merchant_approval: Optional[MerchantApproval] = Field(default_factory=MerchantApproval)
    execution: Optional[Execution] = Field(default_factory=Execution)

    demo_case: bool = False

    audit_log: List[AuditLogEntry] = Field(default_factory=list)

    class Settings:
        name = "cases"
        use_state_management = True # Helps with partial updates
