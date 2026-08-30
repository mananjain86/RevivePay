import { useState, useEffect } from 'react';
import { getBanditScoreboard, resetBandit } from '../api/client';
import ABComparison from './ABComparison';

export default function BanditDashboard({ onRefresh, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState(null);
  const [subTab, setSubTab] = useState('comparison');

  useEffect(() => {
    fetchScoreboard();
  }, [refreshKey]);

  const fetchScoreboard = async () => {
    try {
      setLoading(true);
      const res = await getBanditScoreboard();
      setData(res);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to wipe the bandit state? This cannot be undone.')) return;
    try {
      setResetting(true);
      await resetBandit();
      await fetchScoreboard();
      if (onRefresh) onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm shadow-slate-100 flex justify-center items-center h-64">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-100 flex justify-between items-center">
        <span>Failed to load Bandit Scoreboard: {error}</span>
        <button onClick={fetchScoreboard} className="px-4 py-2 bg-red-100 rounded-lg font-medium hover:bg-red-200 transition-colors">Retry</button>
      </div>
    );
  }

  const { scoreboard, config } = data;
  const failureClasses = Object.keys(scoreboard || {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Multi-Armed Bandit</h2>
          <p className="text-sm text-slate-500 mt-1">Real-time learning of best recovery actions per failure type.</p>
        </div>
        <div className="flex gap-4 items-center">
          <div className="bg-slate-100 px-4 py-2 rounded-xl text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{config.total_trials}</span> Total Trials
          </div>
          <div className="bg-indigo-50 px-4 py-2 rounded-xl text-sm text-indigo-700">
            Current ε: <span className="font-semibold">{config.current_epsilon?.toFixed(3)}</span>
          </div>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-semibold hover:bg-red-100 transition-colors disabled:opacity-50"
          >
            {resetting ? 'Resetting...' : 'Reset Stats'}
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setSubTab('comparison')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
            subTab === 'comparison'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          A/B Comparison
        </button>
        <button
          onClick={() => setSubTab('scoreboard')}
          className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
            subTab === 'scoreboard'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Live Scoreboard
        </button>
      </div>

      {subTab === 'comparison' ? (
        <ABComparison />
      ) : (
        <>
          {failureClasses.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 border border-slate-200 text-center shadow-sm">
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 002-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1">No data yet</h3>
              <p className="text-slate-500">Run some cases through the orchestrator to train the bandit.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {failureClasses.map(fc => (
                <div key={fc} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm shadow-slate-100">
                  <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <h3 className="font-semibold text-slate-900">{fc}</h3>
                    <span className="text-xs font-medium bg-slate-200 text-slate-600 px-2 py-1 rounded-md">{scoreboard[fc].reduce((acc, arm) => acc + arm.trials, 0)} trials</span>
                  </div>
                  <div className="p-0">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-white border-b border-slate-100 text-slate-500 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-6 py-3 font-medium">Action Arm</th>
                          <th className="px-6 py-3 font-medium text-right w-24">Avg Reward</th>
                          <th className="px-6 py-3 font-medium text-right w-24">Trials</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {scoreboard[fc].map((arm, idx) => {
                          const isBest = idx === 0 && arm.trials > 0;
                          return (
                            <tr key={arm.action} className={isBest ? 'bg-green-50/50' : 'bg-white'}>
                              <td className="px-6 py-3 font-mono text-xs">
                                <div className="flex items-center gap-2">
                                  {isBest && <span className="w-2 h-2 rounded-full bg-green-500"></span>}
                                  <span className={isBest ? 'text-green-800 font-semibold' : 'text-slate-700'}>{arm.action}</span>
                                </div>
                              </td>
                              <td className="px-6 py-3 text-right tabular-nums font-semibold text-slate-900">
                                {arm.avg_reward.toFixed(3)}
                              </td>
                              <td className="px-6 py-3 text-right tabular-nums text-slate-500">
                                {arm.trials}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
