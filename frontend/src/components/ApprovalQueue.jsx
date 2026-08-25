import { useState, useEffect } from 'react';
import { getCases, approveCase, rejectCase } from '../api/client';

export default function ApprovalQueue({ refreshKey, onRefresh }) {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    loadCases();
  }, [refreshKey]);

  async function loadCases() {
    try {
      setLoading(true);
      setCases(await getCases('needs_merchant_approval'));
    } catch (error) {
      console.error('Failed to load approval queue:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(caseId, action) {
    try {
      setBusyId(caseId);
      if (action === 'approve') {
        await approveCase(caseId);
      } else {
        await rejectCase(caseId);
      }
      await loadCases();
      onRefresh?.();
    } catch (error) {
      console.error(`Failed to ${action} case:`, error);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-slate-900 mb-6">Merchant Approval Queue</h2>
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="shimmer h-40 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 bg-amber-100 rounded-xl">
            <span className="text-xl">⏳</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900">Merchant Approval Queue</h2>
        </div>
        {cases.length > 0 && (
          <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700">
            {cases.length} pending
          </span>
        )}
      </div>

      {/* Content */}
      {cases.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">✅</div>
          <p className="text-slate-900 font-semibold text-lg mb-2">No cases pending approval</p>
          <p className="text-slate-600 text-sm">
            All clear — the Policy Guard is doing its job
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {cases.map((caseItem) => (
            <div key={caseItem._id} className="p-6 hover:bg-slate-50 transition-colors">
              {/* Case Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-sm font-semibold text-slate-900">
                      {caseItem.customer_id}
                    </span>
                    {caseItem.demo_case && (
                      <span className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 text-xs font-bold rounded-lg">
                        ★
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-black text-slate-900">
                      ₹{caseItem.amount.toLocaleString('en-IN')}
                    </span>
                    <span className="text-sm text-slate-600">
                      {caseItem.case_type === 'failed_payment' ? '💳 Failed' : '🛒 Abandoned'}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-xs text-slate-500">
                  Attempt #{caseItem.attempt_number}
                </span>
              </div>

              {/* Plan Details */}
              {caseItem.plan && (
                <div className="mb-4 p-4 bg-slate-50 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide w-24">
                      Action
                    </span>
                    <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold ${
                      caseItem.plan.recommendation === 'OFFER_DISCOUNT' 
                        ? 'bg-amber-100 text-amber-700' 
                        : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      {caseItem.plan.recommendation.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {caseItem.plan.discount_requested_pct > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide w-24">
                        Discount
                      </span>
                      <span className="font-mono text-orange-600 font-bold text-lg">
                        {caseItem.plan.discount_requested_pct}%
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wide w-24">
                      Confidence
                    </span>
                    <span className="font-mono text-amber-600 font-semibold">
                      {((caseItem.plan.confidence || 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                  {caseItem.plan.reasoning && (
                    <div className="flex gap-3 pt-3 border-t border-slate-200">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wide w-24 pt-1">
                        Reasoning
                      </span>
                      <span className="text-sm text-slate-700 italic leading-relaxed flex-1">
                        {caseItem.plan.reasoning}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Policy Warning */}
              {caseItem.policy_check?.reason && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
                  <span className="text-amber-600">⚠️</span>
                  <span className="text-sm text-amber-900">{caseItem.policy_check.reason}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => handleAction(caseItem._id, 'approve')}
                  disabled={busyId === caseItem._id}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-semibold text-sm rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:cursor-not-allowed disabled:transform-none"
                >
                  {busyId === caseItem._id ? 'Processing...' : '✓ Approve'}
                </button>
                <button
                  onClick={() => handleAction(caseItem._id, 'reject')}
                  disabled={busyId === caseItem._id}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 bg-white hover:bg-slate-50 disabled:bg-slate-100 text-slate-700 disabled:text-slate-400 font-semibold text-sm rounded-xl border border-slate-300 shadow-sm hover:shadow hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:cursor-not-allowed disabled:transform-none"
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
