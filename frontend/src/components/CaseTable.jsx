import { useState, useEffect } from 'react';
import { getCases } from '../api/client';

const STATUS_OPTIONS = [
  '', 'new', 'recovered', 'needs_merchant_approval', 'stopped_safely',
  'blocked_no_consent', 'execution_failed', 'unrecovered_expired',
  'link_created', 'awaiting_payment', 'processing'
];

export default function CaseTable({ onSelectCase, refreshKey }) {
  const [cases, setCases] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCases();
  }, [filter, refreshKey]);

  async function loadCases() {
    try {
      setLoading(true);
      setCases(await getCases(filter));
    } catch (error) {
      console.error('Failed to load cases:', error);
    } finally {
      setLoading(false);
    }
  }

  const getStatusStyles = (status) => {
    const styles = {
      new: 'bg-blue-100 text-blue-700',
      processing: 'bg-blue-100 text-blue-700',
      diagnosed: 'bg-indigo-100 text-indigo-700',
      valued: 'bg-indigo-100 text-indigo-700',
      planned: 'bg-indigo-100 text-indigo-700',
      policy_checked: 'bg-indigo-100 text-indigo-700',
      link_created: 'bg-indigo-100 text-indigo-700',
      approved: 'bg-emerald-100 text-emerald-700',
      recovered: 'bg-emerald-100 text-emerald-800 font-bold',
      needs_merchant_approval: 'bg-amber-100 text-amber-700',
      awaiting_payment: 'bg-amber-100 text-amber-700',
      unrecovered_expired: 'bg-orange-100 text-orange-700',
      execution_failed: 'bg-red-100 text-red-700',
      stopped_safely: 'bg-slate-100 text-slate-700',
      blocked_stop_rule: 'bg-slate-100 text-slate-700',
      blocked_no_consent: 'bg-slate-100 text-slate-600',
    };
    return styles[status] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-slate-900">Recovery Cases</h2>
          <span className="px-3 py-1 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg">
            {cases.length}
          </span>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                Customer
              </th>
              <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                Type
              </th>
              <th className="px-6 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">
                Amount
              </th>
              <th className="px-6 py-4 text-center text-xs font-bold text-slate-600 uppercase tracking-wider">
                Attempt
              </th>
              <th className="px-6 py-4 text-center text-xs font-bold text-slate-600 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-4 text-center text-xs font-bold text-slate-600 uppercase tracking-wider">
                Consent
              </th>
              <th className="px-6 py-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-6 py-4">
                      <div className="shimmer h-5 w-20 rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : cases.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-6 py-16 text-center">
                  <div className="text-6xl mb-4 opacity-20">🔍</div>
                  <p className="text-slate-600 font-medium">No cases found</p>
                  {filter && (
                    <p className="text-slate-500 text-sm mt-1">
                      with status "{filter.replace(/_/g, ' ')}"
                    </p>
                  )}
                </td>
              </tr>
            ) : (
              cases.map((caseItem) => (
                <tr
                  key={caseItem._id}
                  onClick={() => onSelectCase(caseItem._id)}
                  className="cursor-pointer hover:bg-slate-50 transition-colors group"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      {caseItem.demo_case && (
                        <span className="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-600 text-xs font-bold rounded-lg">
                          ★
                        </span>
                      )}
                      <span className="font-mono text-sm font-medium text-slate-900">
                        {caseItem.customer_id}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-700">
                      {caseItem.case_type === 'failed_payment' ? '💳 Failed' : '🛒 Abandoned'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <span className="text-sm font-bold text-slate-900">
                      ₹{caseItem.amount.toLocaleString('en-IN')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={`font-mono text-sm font-semibold ${
                        caseItem.attempt_number >= 3 ? 'text-red-600' : 'text-slate-600'
                      }`}
                    >
                      #{caseItem.attempt_number}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold ${getStatusStyles(caseItem.status)}`}>
                      {caseItem.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {!caseItem.has_recovery_consent && (
                      <span className="text-slate-400" title="No consent">
                        🚫
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity font-semibold text-sm">
                      View →
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
