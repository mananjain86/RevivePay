import { useState } from 'react';
import { runABComparison } from '../api/client';

const ACTION_LABELS = {
  CREATE_PAYMENT_LINK: 'Payment Link',
  SEND_REMINDER: 'Reminder',
  OFFER_DISCOUNT_3: '3% Discount',
  OFFER_DISCOUNT_5: '5% Discount',
  OFFER_DISCOUNT_8: '8% Discount',
  ESCALATE_TO_HUMAN: 'Escalate',
};

function LearningCurveChart({ data }) {
  if (!data) return null;
  const { batch_labels, fixed_cumulative, bandit_cumulative } = data;
  const count = batch_labels.length;
  if (count === 0) return null;

  const allValues = [...fixed_cumulative, ...bandit_cumulative];
  const maxVal = Math.max(...allValues, 1);
  const minVal = Math.min(...allValues, 0);
  const range = maxVal - minVal || 1;

  const W = 680;
  const H = 260;
  const PAD_L = 70;
  const PAD_R = 20;
  const PAD_T = 20;
  const PAD_B = 40;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const x = (i) => PAD_L + (i / (count - 1 || 1)) * plotW;
  const y = (v) => PAD_T + plotH - ((v - minVal) / range) * plotH;

  const toPath = (pts) => pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const fixedPath = toPath(fixed_cumulative);
  const banditPath = toPath(bandit_cumulative);

  // Y-axis ticks
  const yTicks = 5;
  const yLabels = [];
  for (let i = 0; i <= yTicks; i++) {
    const val = minVal + (range / yTicks) * i;
    yLabels.push({ val, py: y(val) });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }}>
      {/* Grid lines */}
      {yLabels.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={t.py} y2={t.py} stroke="#e2e8f0" strokeWidth="1" />
          <text x={PAD_L - 8} y={t.py + 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="monospace">
            ₹{(t.val / 1000).toFixed(0)}k
          </text>
        </g>
      ))}

      {/* Fixed line */}
      <path d={fixedPath} fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="6 3" />
      {/* Bandit line */}
      <path d={banditPath} fill="none" stroke="#6366f1" strokeWidth="2.5" />

      {/* Dots at the end */}
      <circle cx={x(count - 1)} cy={y(fixed_cumulative[count - 1])} r="4" fill="#94a3b8" />
      <circle cx={x(count - 1)} cy={y(bandit_cumulative[count - 1])} r="4" fill="#6366f1" />

      {/* Legend */}
      <g transform={`translate(${PAD_L + 10}, ${PAD_T + 10})`}>
        <line x1="0" x2="20" y1="0" y2="0" stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="6 3" />
        <text x="26" y="4" fill="#64748b" fontSize="11" fontWeight="600">Fixed Rules</text>
        <line x1="0" x2="20" y1="18" y2="18" stroke="#6366f1" strokeWidth="2.5" />
        <text x="26" y="22" fill="#4f46e5" fontSize="11" fontWeight="600">Bandit (Learning)</text>
      </g>

      {/* X-axis label */}
      <text x={PAD_L + plotW / 2} y={H - 4} textAnchor="middle" fill="#94a3b8" fontSize="11">
        Cases Processed →
      </text>
    </svg>
  );
}

export default function ABComparison() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [numCases, setNumCases] = useState(200);

  const handleRun = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await runABComparison(numCases);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">A/B Comparison</h2>
          <p className="text-sm text-slate-500 mt-1">
            Fixed Rules vs. Bandit — same cases, same simulation, different strategy.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-100 px-3 py-2 rounded-xl">
            <label className="text-xs font-medium text-slate-500">Cases:</label>
            <select
              value={numCases}
              onChange={(e) => setNumCases(Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-slate-900 outline-none cursor-pointer"
            >
              <option value={60}>60</option>
              <option value={120}>120</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </div>
          <button
            onClick={handleRun}
            disabled={loading}
            className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Running...
              </>
            ) : (
              'Run Comparison'
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-100">
          {error}
        </div>
      )}

      {!result && !loading && (
        <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center shadow-sm">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">Ready to Compare</h3>
          <p className="text-slate-500 max-w-md mx-auto">
            Click <span className="font-semibold text-indigo-600">Run Comparison</span> to simulate {numCases} cases through both strategies and see which recovers more.
          </p>
        </div>
      )}

      {result && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-4">
            {/* Fixed */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-slate-400"></div>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wide">Fixed Rules</h3>
              </div>
              <div className="text-3xl font-bold text-slate-900 tabular-nums">
                ₹{result.fixed.net_recovered.toLocaleString('en-IN')}
              </div>
              <div className="text-sm text-slate-500 mt-1">
                {result.fixed.cases_recovered} / {result.config.num_cases} recovered ({result.fixed.recovery_rate_pct}%)
              </div>
            </div>

            {/* Bandit */}
            <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl p-6 border border-indigo-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
                <h3 className="text-sm font-bold text-indigo-600 uppercase tracking-wide">Bandit</h3>
              </div>
              <div className="text-3xl font-bold text-slate-900 tabular-nums">
                ₹{result.bandit.net_recovered.toLocaleString('en-IN')}
              </div>
              <div className="text-sm text-indigo-600 mt-1">
                {result.bandit.cases_recovered} / {result.config.num_cases} recovered ({result.bandit.recovery_rate_pct}%)
              </div>
            </div>

            {/* Improvement */}
            <div className={`rounded-2xl p-6 border shadow-sm ${result.improvement.net_delta >= 0 ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200' : 'bg-gradient-to-br from-red-50 to-orange-50 border-red-200'}`}>
              <div className="flex items-center gap-2 mb-3">
                <svg className={`w-5 h-5 ${result.improvement.net_delta >= 0 ? 'text-emerald-500' : 'text-red-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {result.improvement.net_delta >= 0 ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                  )}
                </svg>
                <h3 className={`text-sm font-bold uppercase tracking-wide ${result.improvement.net_delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Improvement</h3>
              </div>
              <div className={`text-3xl font-bold tabular-nums ${result.improvement.net_delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {result.improvement.net_delta >= 0 ? '+' : ''}₹{result.improvement.net_delta.toLocaleString('en-IN')}
              </div>
              <div className={`text-sm mt-1 ${result.improvement.net_delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {result.improvement.net_delta >= 0 ? '+' : ''}{result.improvement.pct}% net recovery
              </div>
            </div>
          </div>

          {/* Learning Curve */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">Learning Curve</h3>
              <p className="text-xs text-slate-500 mt-0.5">Cumulative net recovery as cases are processed. The bandit starts cold and learns.</p>
            </div>
            <div className="p-6">
              <LearningCurveChart data={result.learning_curve} />
            </div>
          </div>

          {/* Per-Failure Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">Per-Failure-Class Breakdown</h3>
              <p className="text-xs text-slate-500 mt-0.5">How each strategy performed per failure type.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3 font-medium">Failure Class</th>
                    <th className="px-6 py-3 font-medium text-center" colSpan={2}>Fixed Rule</th>
                    <th className="px-6 py-3 font-medium text-center" colSpan={2}>Bandit</th>
                    <th className="px-6 py-3 font-medium text-right">Delta</th>
                  </tr>
                  <tr className="text-[10px] text-slate-400">
                    <th className="px-6 pb-2"></th>
                    <th className="px-3 pb-2 text-center font-normal">Action</th>
                    <th className="px-3 pb-2 text-center font-normal">Net ₹</th>
                    <th className="px-3 pb-2 text-center font-normal">Recovered</th>
                    <th className="px-3 pb-2 text-center font-normal">Net ₹</th>
                    <th className="px-6 pb-2 text-right font-normal">Δ Net ₹</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {result.per_failure_class.map((row) => {
                    const positive = row.delta_net >= 0;
                    return (
                      <tr key={row.failure_class} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-3 font-mono text-xs text-slate-800">{row.failure_class}</td>
                        <td className="px-3 py-3 text-center text-xs text-slate-500">{ACTION_LABELS[row.fixed_rule] || row.fixed_rule}</td>
                        <td className="px-3 py-3 text-center tabular-nums font-medium text-slate-700">₹{row.fixed_net.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-3 text-center tabular-nums font-semibold text-indigo-700">{row.bandit_recovered}/{row.bandit_total}</td>
                        <td className="px-3 py-3 text-center tabular-nums font-medium text-indigo-700">₹{row.bandit_net.toLocaleString('en-IN')}</td>
                        <td className={`px-6 py-3 text-right tabular-nums font-bold ${positive ? 'text-emerald-600' : 'text-red-500'}`}>
                          {positive ? '+' : ''}₹{row.delta_net.toLocaleString('en-IN')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bandit Final Scoreboard */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">Bandit's Learned Preferences</h3>
              <p className="text-xs text-slate-500 mt-0.5">What the bandit learned works best after processing all {result.config.num_cases} cases.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-100">
              {Object.entries(result.bandit_scoreboard).map(([fc, arms]) => (
                <div key={fc} className="bg-white p-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{fc}</h4>
                  <div className="space-y-1">
                    {arms.map((arm, idx) => {
                      const maxTrials = Math.max(...arms.map(a => a.trials), 1);
                      const barWidth = (arm.trials / maxTrials) * 100;
                      return (
                        <div key={arm.action} className="flex items-center gap-2 text-xs">
                          <span className={`w-24 truncate font-mono ${idx === 0 && arm.trials > 0 ? 'text-indigo-700 font-bold' : 'text-slate-600'}`}>
                            {ACTION_LABELS[arm.action] || arm.action}
                          </span>
                          <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${idx === 0 && arm.trials > 0 ? 'bg-indigo-500' : 'bg-slate-300'}`}
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                          <span className="w-12 text-right tabular-nums text-slate-500">{arm.avg_reward.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
