import { useState, useEffect } from 'react';
import { getSummary } from '../api/client';

export default function SummaryCard({ refreshKey }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [refreshKey]);

  async function loadStats() {
    try {
      setLoading(true);
      setStats(await getSummary());
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (amount) => `₹${(amount || 0).toLocaleString('en-IN')}`;

  if (loading || !stats) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-32 rounded-2xl" />
        ))}
      </div>
    );
  }

  const metrics = [
    {
      label: 'Total At Risk',
      value: formatCurrency(stats.total_at_risk),
      subtitle: `${stats.total_cases} cases`,
      icon: '⚡',
      bgGradient: 'from-amber-500 to-amber-600',
    },

    {
      label: 'Verified Recovery',
      value: formatCurrency(stats.verified?.recovered),
      subtitle: `${stats.verified?.paid_count || 0}/${stats.verified?.total_demo_cases || 0} payments confirmed`,
      icon: '✓',
      bgGradient: 'from-emerald-500 to-emerald-600',
    },
    {
      label: 'Safely Stopped',
      value:
        (stats.status_counts?.stopped_safely || 0) +
        (stats.status_counts?.blocked_stop_rule || 0) +
        (stats.status_counts?.blocked_no_consent || 0),
      subtitle: 'Policy guard blocks',
      icon: '🛡️',
      bgGradient: 'from-purple-500 to-purple-600',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {metrics.map((metric, index) => (
          <div 
            key={index} 
            className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                  {metric.label}
                </p>
                <p className="text-3xl font-bold text-slate-900">{metric.value}</p>
                <p className="text-xs text-slate-500 mt-1">{metric.subtitle}</p>
              </div>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${metric.bgGradient} flex items-center justify-center text-2xl shadow-lg`}>
                {metric.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm border-l-4 border-l-emerald-500">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
              Verified Razorpay Recovery
            </h3>
          </div>
          <div className="flex items-center gap-6 mb-2">
            <div>
              <span className="text-3xl font-black text-slate-900">
                {formatCurrency(stats.verified?.recovered)}
              </span>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">Gross</p>
            </div>
            <div className="text-slate-200 text-3xl font-light">|</div>
            <div>
              <span className="text-3xl font-black text-emerald-600">
                {formatCurrency(stats.verified?.net_recovered)}
              </span>
              <p className="text-xs text-emerald-600 font-medium uppercase tracking-wide">Net (After Costs)</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {stats.verified?.paid_count || 0} of {stats.verified?.total_demo_cases || 0} paid · Real Razorpay test-mode
          </p>

        </div>
      </div>

      {/* Status Breakdown */}
      {Object.keys(stats.status_counts || {}).length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">
            Status Breakdown
          </h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.status_counts)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => {
                const statusStyles = {
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
                
                return (
                  <span key={status} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold ${statusStyles[status] || 'bg-gray-100 text-gray-700'}`}>
                    {count} {status.replace(/_/g, ' ')}
                  </span>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
