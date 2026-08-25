import { useState, useEffect } from 'react';
import { getCaseById } from '../api/client';

const STAGE_META = {
  diagnosis: { icon: '🔍', color: '#3B82F6', label: 'Diagnosis' },
  value_assessment: { icon: '📊', color: '#6366F1', label: 'Value Assessment' },
  plan: { icon: '📋', color: '#8B5CF6', label: 'Recovery Plan' },
  policy_check: { icon: '🛡️', color: '#F59E0B', label: 'Policy Check' },
  policy_rejected_fallback: { icon: '⚠️', color: '#F97316', label: 'Policy Rejected → Fallback' },
  fallback_policy_check: { icon: '🔄', color: '#FB923C', label: 'Fallback Re-check' },
  execution: { icon: '⚡', color: '#10B981', label: 'Execution' },
  merchant_approved: { icon: '✅', color: '#059669', label: 'Merchant Approved' },
  merchant_rejected: { icon: '❌', color: '#EF4444', label: 'Merchant Rejected' },
  stopped_safely: { icon: '🛑', color: '#94A3B8', label: 'Stopped Safely' },
  blocked_no_consent: { icon: '🚫', color: '#64748B', label: 'Blocked (No Consent)' },
  webhook_payment_confirmed: { icon: '💰', color: '#10B981', label: 'Payment Confirmed' },
  webhook_payment_not_completed: { icon: '⏰', color: '#F97316', label: 'Payment Not Completed' },
  orchestrator_error: { icon: '💥', color: '#DC2626', label: 'Error' },
  fallback_blocked: { icon: '🚧', color: '#94A3B8', label: 'Fallback Blocked' },
};

function Field({ label, children }) {
  return (
    <div className="flex gap-3 py-2">
      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide min-w-[100px] pt-1">
        {label}
      </span>
      <div className="text-sm text-slate-900 flex-1">{children}</div>
    </div>
  );
}

function formatValue(key, value) {
  if (value === null || value === undefined) {
    return <span className="text-slate-400">—</span>;
  }
  
  if (typeof value === 'boolean') {
    return value ? (
      <span className="text-emerald-600 font-semibold">Yes</span>
    ) : (
      <span className="text-red-600 font-semibold">No</span>
    );
  }
  
  if (typeof value === 'number') {
    if (key === 'confidence') {
      return <span className="font-mono text-amber-600 font-bold">{(value * 100).toFixed(0)}%</span>;
    }
    if (key === 'discount_requested_pct') {
      return <span className="font-mono text-orange-600 font-bold">{value}%</span>;
    }
    if (key === 'amount' || key === 'cart_value') {
      return <span className="font-bold text-slate-900">₹{value.toLocaleString('en-IN')}</span>;
    }
    return <span className="font-mono text-blue-600">{value}</span>;
  }
  
  if (typeof value === 'object' && !Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {Object.entries(value).map(([k, v]) => (
          <Field key={k} label={k.replace(/_/g, ' ')}>
            {formatValue(k, v)}
          </Field>
        ))}
      </div>
    );
  }
  
  // Decision badges
  const decisionStyles = {
    APPROVED: 'bg-emerald-100 text-emerald-700',
    REJECTED_FALLBACK: 'bg-orange-100 text-orange-700',
    NEEDS_MERCHANT_APPROVAL: 'bg-amber-100 text-amber-700',
    BLOCKED_STOP_RULE: 'bg-slate-100 text-slate-700',
    BLOCKED_NO_CONSENT: 'bg-slate-100 text-slate-600',
    CREATE_PAYMENT_LINK: 'bg-blue-100 text-blue-700',
    SEND_REMINDER: 'bg-blue-100 text-blue-600',
    OFFER_DISCOUNT: 'bg-amber-100 text-amber-700',
    ESCALATE_TO_HUMAN: 'bg-orange-100 text-orange-700',
    DO_NOT_CONTACT: 'bg-slate-100 text-slate-600',
  };
  
  if (['decision', 'recommendation', 'action_taken', 'fallback_action'].includes(key) && decisionStyles[value]) {
    return (
      <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${decisionStyles[value]}`}>
        {value}
      </span>
    );
  }
  
  if (key === 'failure_class') {
    return <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-100 text-blue-700">{value}</span>;
  }
  
  if (key === 'priority') {
    const colors = { high: 'text-red-600', medium: 'text-amber-600', low: 'text-slate-500' };
    return <span className={`font-bold ${colors[value] || 'text-blue-600'}`}>{value}</span>;
  }
  
  if (['reasoning', 'reason', 'message'].includes(key)) {
    return <span className="text-blue-700 italic">{String(value)}</span>;
  }
  
  return <span className="text-slate-700">{String(value)}</span>;
}

export default function CaseDetailTrace({ caseId, onClose }) {
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (caseId) {
      loadCase();
    }
  }, [caseId]);

  async function loadCase() {
    try {
      setLoading(true);
      setCaseData(await getCaseById(caseId));
    } catch (error) {
      console.error('Failed to load case:', error);
    } finally {
      setLoading(false);
    }
  }

  if (!caseId) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl h-full bg-white overflow-y-auto shadow-2xl slide-in">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-8 py-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900 mb-1">Reasoning Trace</h2>
              {caseData && (
                <span className="font-mono text-sm text-slate-600">{caseData.customer_id}</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors"
            >
              <span className="text-xl">✕</span>
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="p-8 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-32 rounded-2xl" />
            ))}
          </div>
        ) : caseData ? (
          <div className="p-8">
            {/* Case Info */}
            <div className="card p-6 mb-8">
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    Type
                  </div>
                  <div className="text-sm text-slate-900">
                    {caseData.case_type === 'failed_payment' ? '💳 Failed Payment' : '🛒 Abandoned Cart'}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    Amount
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    ₹{caseData.amount.toLocaleString('en-IN')}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    Attempt
                  </div>
                  <div
                    className={`text-sm font-mono font-semibold ${
                      caseData.attempt_number >= 3 ? 'text-red-600' : 'text-slate-700'
                    }`}
                  >
                    #{caseData.attempt_number}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    Status
                  </div>
                  <span className={`badge badge-${caseData.status}`}>
                    {caseData.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
              {caseData.failure_reason_raw && (
                <div className="pt-6 border-t border-slate-200">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                    Failure Reason
                  </div>
                  <div className="text-sm text-blue-700 italic">{caseData.failure_reason_raw}</div>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-6">
              Decision Timeline
            </div>

            {(caseData.audit_log || []).length === 0 ? (
              <div className="text-center py-16">
                <div className="text-5xl mb-3 opacity-30">⏳</div>
                <p className="text-slate-700 font-medium mb-1">No decisions yet</p>
                <p className="text-slate-500 text-sm">Run the batch to process this case</p>
              </div>
            ) : (
              <div>
                {caseData.audit_log.map((entry, index) => {
                  const meta = STAGE_META[entry.stage] || {
                    icon: '📌',
                    color: '#64748B',
                    label: entry.stage,
                  };
                  return (
                    <div key={index} className="timeline-item">
                      <div
                        className="timeline-dot"
                        style={{ background: meta.color }}
                      >
                        <span className="text-xs">{meta.icon}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-sm font-bold text-slate-900">{meta.label}</span>
                          <span className="text-xs text-slate-500 font-mono">
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {entry.output && (
                          <div className="card p-4 bg-slate-50">
                            {Object.entries(entry.output).map(([key, value]) => (
                              <Field key={key} label={key.replace(/_/g, ' ')}>
                                {formatValue(key, value)}
                              </Field>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
