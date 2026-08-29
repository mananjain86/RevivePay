import { useState, useEffect, useMemo } from 'react';
import {
  runSweep,
  getSweepResults,
  applySweepWinner,
  revertThresholds,
  getActiveConfig,
  getPreApplySummary,
  resetCases,
  runBatch,
  getJobStatus,
  getSummary,
} from '../api/client';

// ─── Helpers ────────────────────────────────────────────────────────────────

const PARAM_LABELS = {
  max_attempts: 'Max Attempts',
  min_recoverable_amount: 'Min Amount (₹)',
  auto_approve_discount_max_pct: 'Auto-Approve Disc %',
  approval_discount_max_pct: 'Max Discount %',
  min_confidence_auto_approve: 'Min Confidence',
};

const PARAM_KEYS = Object.keys(PARAM_LABELS);

function formatCurrency(val) {
  if (val == null) return '—';
  return `₹${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatPct(val) {
  if (val == null) return '—';
  return `${Number(val).toFixed(1)}%`;
}

function deltaArrow(val) {
  if (val > 0) return '↑';
  if (val < 0) return '↓';
  return '→';
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ThresholdSweep({ onRefresh }) {
  const [report, setReport] = useState(null);
  const [activeConfig, setActiveConfig] = useState(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState(null);
  const [sortCol, setSortCol] = useState('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [showAllRows, setShowAllRows] = useState(false);
  const [beforeAfter, setBeforeAfter] = useState(null); // { before, after }
  const [rerunning, setRerunning] = useState(false);

  // Load cached results and active config on mount
  useEffect(() => {
    getActiveConfig().then(setActiveConfig).catch(() => {});
    getSweepResults().then(setReport).catch(() => {});
  }, []);

  // ─── Run Sweep ──────────────────────────────────────────────────────────

  async function handleRunSweep() {
    setLoading(true);
    setError(null);
    try {
      const data = await runSweep();
      setReport(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // ─── Apply Winner ────────────────────────────────────────────────────────

  async function handleApply() {
    if (!report?.best) return;
    setApplying(true);
    setError(null);
    try {
      const t = report.best.thresholds;
      await applySweepWinner({
        max_attempts: t.max_attempts,
        min_recoverable_amount: t.min_recoverable_amount,
        auto_approve_discount_max_pct: t.auto_approve_discount_max_pct,
        approval_discount_max_pct: t.approval_discount_max_pct,
        min_confidence_auto_approve: t.min_confidence_auto_approve,
      });
      const cfg = await getActiveConfig();
      setActiveConfig(cfg);
    } catch (e) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  }

  // ─── Revert ──────────────────────────────────────────────────────────────

  async function handleRevert() {
    setReverting(true);
    setError(null);
    try {
      await revertThresholds();
      const cfg = await getActiveConfig();
      setActiveConfig(cfg);
      setBeforeAfter(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setReverting(false);
    }
  }

  // ─── Apply + Re-run (full flow) ──────────────────────────────────────────

  async function handleApplyAndRerun() {
    if (!report?.best) return;
    setRerunning(true);
    setError(null);
    try {
      // 1. Capture "before" summary with current (old) thresholds
      const beforeSummary = await getSummary();

      // 2. Apply winning thresholds
      const t = report.best.thresholds;
      await applySweepWinner({
        max_attempts: t.max_attempts,
        min_recoverable_amount: t.min_recoverable_amount,
        auto_approve_discount_max_pct: t.auto_approve_discount_max_pct,
        approval_discount_max_pct: t.approval_discount_max_pct,
        min_confidence_auto_approve: t.min_confidence_auto_approve,
      });

      // 3. Reset cases and re-run batch
      await resetCases();
      const { jobId } = await runBatch();

      // 4. Poll for batch completion
      let done = false;
      while (!done) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await getJobStatus(jobId);
        if (status.status === 'completed') done = true;
      }

      // 5. Capture "after" summary with new thresholds
      const afterSummary = await getSummary();

      setBeforeAfter({ before: beforeSummary, after: afterSummary });

      const cfg = await getActiveConfig();
      setActiveConfig(cfg);
      if (onRefresh) onRefresh();

    } catch (e) {
      setError(e.message);
    } finally {
      setRerunning(false);
    }
  }

  // ─── Sorting ─────────────────────────────────────────────────────────────

  const sortedResults = useMemo(() => {
    if (!report?.results) return [];
    const arr = [...report.results];
    arr.sort((a, b) => {
      let va, vb;
      if (sortCol === 'rank') { va = a.rank; vb = b.rank; }
      else if (sortCol === 'net_recovered') { va = a.net_recovered; vb = b.net_recovered; }
      else if (sortCol === 'gross_recovered') { va = a.gross_recovered; vb = b.gross_recovered; }
      else if (sortCol === 'recovery_rate_pct') { va = a.recovery_rate_pct; vb = b.recovery_rate_pct; }
      else if (sortCol === 'cases_needing_approval') { va = a.cases_needing_approval; vb = b.cases_needing_approval; }
      else if (PARAM_KEYS.includes(sortCol)) { va = a.thresholds[sortCol]; vb = b.thresholds[sortCol]; }
      else { va = a.rank; vb = b.rank; }
      return sortAsc ? va - vb : vb - va;
    });
    return arr;
  }, [report, sortCol, sortAsc]);

  const visibleResults = showAllRows ? sortedResults : sortedResults.slice(0, 20);

  function handleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(col === 'rank'); }
  }

  const sortIcon = (col) => sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : '';

  // ─── Sensitivity Data ────────────────────────────────────────────────────

  const sensitivityData = useMemo(() => {
    if (!report?.results || !report?.best) return {};
    const best = report.best.thresholds;
    const data = {};

    for (const key of PARAM_KEYS) {
      // Gather all results where every param matches the best EXCEPT this one
      const otherKeys = PARAM_KEYS.filter(k => k !== key);
      const matches = report.results.filter(r =>
        otherKeys.every(k => r.thresholds[k] === best[k])
      );
      // Sort by the varying parameter value
      matches.sort((a, b) => a.thresholds[key] - b.thresholds[key]);
      data[key] = matches.map(r => ({
        value: r.thresholds[key],
        net: r.net_recovered,
        isBest: r.thresholds[key] === best[key],
      }));
    }
    return data;
  }, [report]);

  // ─── Render ──────────────────────────────────────────────────────────────

  const isFactoryDefaults = activeConfig?.is_factory_defaults !== false;
  const defaultsResult = report?.defaults;
  const bestResult = report?.best;

  function isDefaultsRow(r) {
    return defaultsResult && r.rank === defaultsResult.rank;
  }

  function isBestRow(r) {
    return r.rank === 1;
  }

  return (
    <div className="space-y-6">

      {/* ─── Active Config Status Bar ─────────────────────────────────── */}
      <div className={`rounded-2xl border px-6 py-4 flex items-center justify-between transition-all ${
        isFactoryDefaults
          ? 'bg-white border-slate-200'
          : 'bg-amber-50 border-amber-200'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${isFactoryDefaults ? 'bg-slate-400' : 'bg-amber-500 animate-pulse'}`} />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {isFactoryDefaults ? 'Factory Defaults Active' : 'Optimized Thresholds Active'}
            </p>
            <p className="text-xs text-slate-500">
              {isFactoryDefaults
                ? 'Policy guard is using the original hardcoded thresholds'
                : `Applied at ${new Date(activeConfig?.applied_at).toLocaleTimeString()}`
              }
            </p>
          </div>
        </div>
        {!isFactoryDefaults && (
          <button
            onClick={handleRevert}
            disabled={reverting}
            className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-100 rounded-lg hover:bg-amber-200 transition-colors disabled:opacity-50"
          >
            {reverting ? 'Reverting…' : 'Revert to Defaults'}
          </button>
        )}
      </div>

      {/* ─── Sweep Launcher ───────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between">
            <div className="max-w-xl">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="text-2xl">🔬</span> Threshold Sweep
              </h2>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Systematically test hundreds of policy parameter combinations against your case batch.
                Finds the optimal thresholds that maximize net recovery — no guessing required.
              </p>
              {report && (
                <p className="mt-2 text-xs text-slate-400">
                  Last run: {new Date(report.timestamp).toLocaleString()} · {report.grid_size} combinations × {report.total_cases} cases
                </p>
              )}
            </div>
            <button
              onClick={handleRunSweep}
              disabled={loading}
              className="flex-shrink-0 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-semibold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 100 8v4a8 8 0 01-8-8z" />
                  </svg>
                  Running…
                </span>
              ) : (
                'Run Sweep'
              )}
            </button>
          </div>

          {/* Loading bar */}
          {loading && (
            <div className="mt-6 rounded-full h-2 bg-slate-100 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 sweep-progress rounded-full" />
            </div>
          )}
        </div>

        {error && (
          <div className="mx-6 mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* ─── Results (only shown after sweep completes) ───────────────── */}
      {report && !loading && (
        <>
          {/* ─── Winner Card ───────────────────────────────────────────── */}
          {bestResult && (
            <div className="rounded-2xl bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 border border-amber-200 shadow-sm pulse-gold overflow-hidden fade-in-up">
              <div className="p-6 sm:p-8">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-amber-900 flex items-center gap-2">
                      <span className="text-2xl">🏆</span> Optimal Threshold Configuration
                    </h3>
                    <p className="mt-1 text-sm text-amber-700">
                      Best performing combination out of {report.grid_size} tested
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-extrabold text-amber-900 count-pop">
                      {formatCurrency(bestResult.net_recovered)}
                    </p>
                    <p className="text-sm text-amber-600 font-medium">Net Recovered</p>
                  </div>
                </div>

                {/* Winner parameters */}
                <div className="mt-6 grid grid-cols-5 gap-3">
                  {PARAM_KEYS.map(key => (
                    <div key={key} className="bg-white/70 backdrop-blur-sm rounded-xl px-4 py-3 text-center border border-amber-100">
                      <p className="text-xs text-amber-600 font-medium">{PARAM_LABELS[key]}</p>
                      <p className="text-lg font-bold text-amber-900 mt-1">
                        {key.includes('pct') || key.includes('confidence')
                          ? bestResult.thresholds[key]
                          : key.includes('amount')
                            ? `₹${bestResult.thresholds[key]}`
                            : bestResult.thresholds[key]
                        }
                      </p>
                    </div>
                  ))}
                </div>

                {/* Winner metrics row */}
                <div className="mt-4 grid grid-cols-4 gap-3">
                  <div className="bg-white/50 rounded-lg px-3 py-2 text-center">
                    <p className="text-xs text-slate-500">Recovery Rate</p>
                    <p className="text-sm font-bold text-slate-800">{formatPct(bestResult.recovery_rate_pct)}</p>
                  </div>
                  <div className="bg-white/50 rounded-lg px-3 py-2 text-center">
                    <p className="text-xs text-slate-500">Gross Recovered</p>
                    <p className="text-sm font-bold text-slate-800">{formatCurrency(bestResult.gross_recovered)}</p>
                  </div>
                  <div className="bg-white/50 rounded-lg px-3 py-2 text-center">
                    <p className="text-xs text-slate-500">Total Costs</p>
                    <p className="text-sm font-bold text-slate-800">{formatCurrency(bestResult.total_discount_cost + bestResult.total_contact_cost)}</p>
                  </div>
                  <div className="bg-white/50 rounded-lg px-3 py-2 text-center">
                    <p className="text-xs text-slate-500">Approvals Needed</p>
                    <p className="text-sm font-bold text-slate-800">{bestResult.cases_needing_approval}</p>
                  </div>
                </div>

                {/* Apply buttons */}
                <div className="mt-6 flex items-center gap-3">
                  <button
                    onClick={handleApply}
                    disabled={applying || !isFactoryDefaults}
                    className="px-5 py-2.5 bg-amber-600 text-white text-sm font-semibold rounded-xl hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-200"
                  >
                    {applying ? 'Applying…' : !isFactoryDefaults ? '✓ Applied' : 'Apply These Thresholds'}
                  </button>
                  <button
                    onClick={handleApplyAndRerun}
                    disabled={rerunning}
                    className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-semibold rounded-xl hover:from-emerald-700 hover:to-teal-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-200"
                  >
                    {rerunning ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 100 8v4a8 8 0 01-8-8z" />
                        </svg>
                        Applying & Re-running Batch…
                      </span>
                    ) : 'Apply + Re-run Batch (Full Comparison)'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Before / After Comparison ──────────────────────────────── */}
          {beforeAfter && (
            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden fade-in-up" style={{ animationDelay: '0.1s' }}>
              <div className="p-6 sm:p-8">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-6">
                  <span className="text-2xl">📊</span> Before & After Comparison
                </h3>

                <div className="grid grid-cols-2 gap-6">
                  {/* Before */}
                  <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-3 h-3 rounded-full bg-slate-400" />
                      <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Original Defaults</h4>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-slate-500">Net Recovered</p>
                        <p className="text-2xl font-extrabold text-slate-700">{formatCurrency(beforeAfter.before?.simulated?.net_recovered)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Gross Recovered</p>
                        <p className="text-lg font-bold text-slate-600">{formatCurrency(beforeAfter.before?.simulated?.recovered)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Recovery Rate</p>
                        <p className="text-lg font-bold text-slate-600">{beforeAfter.before?.simulated?.recovery_rate ?? '—'}%</p>
                      </div>
                    </div>
                  </div>

                  {/* After */}
                  <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                      <h4 className="text-sm font-bold text-emerald-700 uppercase tracking-wider">Optimized</h4>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-emerald-600">Net Recovered</p>
                        <p className="text-2xl font-extrabold text-emerald-800">{formatCurrency(beforeAfter.after?.simulated?.net_recovered)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-emerald-600">Gross Recovered</p>
                        <p className="text-lg font-bold text-emerald-700">{formatCurrency(beforeAfter.after?.simulated?.recovered)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-emerald-600">Recovery Rate</p>
                        <p className="text-lg font-bold text-emerald-700">{beforeAfter.after?.simulated?.recovery_rate ?? '—'}%</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Delta banner */}
                {(() => {
                  const beforeNet = beforeAfter.before?.simulated?.net_recovered ?? 0;
                  const afterNet = beforeAfter.after?.simulated?.net_recovered ?? 0;
                  const delta = afterNet - beforeNet;
                  const deltaPct = beforeNet > 0 ? ((delta / beforeNet) * 100) : 0;
                  return (
                    <div className={`mt-6 rounded-xl px-6 py-4 text-center ${
                      delta > 0 ? 'bg-emerald-100 border border-emerald-200' :
                      delta < 0 ? 'bg-red-100 border border-red-200' :
                      'bg-slate-100 border border-slate-200'
                    }`}>
                      <p className={`text-2xl font-extrabold ${
                        delta > 0 ? 'text-emerald-800' : delta < 0 ? 'text-red-800' : 'text-slate-800'
                      }`}>
                        {deltaArrow(delta)} {formatCurrency(Math.abs(delta))} {delta > 0 ? 'more' : delta < 0 ? 'less' : 'same'} recovered
                        {deltaPct !== 0 && ` (${delta > 0 ? '+' : ''}${deltaPct.toFixed(1)}%)`}
                      </p>
                      <p className="text-sm text-slate-600 mt-1">
                        With optimized thresholds vs. original defaults
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ─── Sweep Comparison (Simulated) ──────────────────────────── */}
          {defaultsResult && bestResult && !beforeAfter && (
            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden fade-in-up" style={{ animationDelay: '0.1s' }}>
              <div className="p-6 sm:p-8">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-6">
                  <span className="text-2xl">⚡</span> Projected Improvement
                </h3>

                <div className="grid grid-cols-2 gap-6">
                  {/* Defaults */}
                  <div className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-3 h-3 rounded-full bg-slate-400" />
                      <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Current Defaults (Rank #{defaultsResult.rank})</h4>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-slate-500">Net Recovered</p>
                        <p className="text-2xl font-extrabold text-slate-700">{formatCurrency(defaultsResult.net_recovered)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Recovery Rate</p>
                        <p className="text-lg font-bold text-slate-600">{formatPct(defaultsResult.recovery_rate_pct)}</p>
                      </div>
                      <div className="pt-3 border-t border-slate-200">
                        {PARAM_KEYS.map(key => (
                          <div key={key} className="flex justify-between text-xs py-0.5">
                            <span className="text-slate-500">{PARAM_LABELS[key]}</span>
                            <span className="font-mono font-medium text-slate-700">{defaultsResult.thresholds[key]}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Optimal */}
                  <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-3 h-3 rounded-full bg-emerald-500" />
                      <h4 className="text-sm font-bold text-emerald-700 uppercase tracking-wider">Optimal (Rank #1)</h4>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-emerald-600">Net Recovered</p>
                        <p className="text-2xl font-extrabold text-emerald-800">{formatCurrency(bestResult.net_recovered)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-emerald-600">Recovery Rate</p>
                        <p className="text-lg font-bold text-emerald-700">{formatPct(bestResult.recovery_rate_pct)}</p>
                      </div>
                      <div className="pt-3 border-t border-emerald-200">
                        {PARAM_KEYS.map(key => {
                          const changed = bestResult.thresholds[key] !== defaultsResult.thresholds[key];
                          return (
                            <div key={key} className="flex justify-between text-xs py-0.5">
                              <span className="text-emerald-600">{PARAM_LABELS[key]}</span>
                              <span className={`font-mono font-medium ${changed ? 'text-emerald-800 bg-emerald-200 px-1.5 rounded' : 'text-emerald-700'}`}>
                                {bestResult.thresholds[key]}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Improvement delta */}
                <div className={`mt-6 rounded-xl px-6 py-4 text-center ${
                  report.improvement_net > 0 ? 'bg-emerald-100 border border-emerald-200' :
                  'bg-slate-100 border border-slate-200'
                }`}>
                  <p className={`text-2xl font-extrabold ${
                    report.improvement_net > 0 ? 'text-emerald-800' : 'text-slate-800'
                  }`}>
                    {deltaArrow(report.improvement_net)} {formatCurrency(Math.abs(report.improvement_net))} improvement
                    {report.improvement_pct !== 0 && ` (+${report.improvement_pct.toFixed(1)}%)`}
                  </p>
                  <p className="text-sm text-slate-600 mt-1">
                    Projected net recovery improvement based on sweep simulation
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ─── Sensitivity Analysis ──────────────────────────────────── */}
          {Object.keys(sensitivityData).length > 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden fade-in-up" style={{ animationDelay: '0.2s' }}>
              <div className="p-6 sm:p-8">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-6">
                  <span className="text-2xl">📈</span> Sensitivity Analysis
                  <span className="text-xs font-normal text-slate-500 ml-2">How each parameter affects net recovery (others held at optimal)</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {PARAM_KEYS.map(key => {
                    const points = sensitivityData[key] || [];
                    if (points.length === 0) return null;
                    const maxNet = Math.max(...points.map(p => p.net));
                    const minNet = Math.min(...points.map(p => p.net));
                    const range = maxNet - minNet || 1;

                    return (
                      <div key={key} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-xs font-semibold text-slate-700 mb-3">{PARAM_LABELS[key]}</p>
                        <div className="space-y-2">
                          {points.map((pt, i) => {
                            const width = ((pt.net - minNet) / range) * 100;
                            return (
                              <div key={i} className="flex items-center gap-2">
                                <span className={`text-xs font-mono w-10 text-right flex-shrink-0 ${pt.isBest ? 'font-bold text-amber-700' : 'text-slate-600'}`}>
                                  {pt.value}
                                </span>
                                <div className="flex-1 h-5 bg-slate-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all ${pt.isBest ? 'bg-gradient-to-r from-amber-400 to-amber-500' : 'bg-gradient-to-r from-indigo-300 to-indigo-400'}`}
                                    style={{ width: `${Math.max(width, 4)}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-mono w-16 flex-shrink-0 ${pt.isBest ? 'font-bold text-amber-700' : 'text-slate-500'}`}>
                                  {formatCurrency(pt.net)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ─── Full Results Table ─────────────────────────────────────── */}
          <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden fade-in-up" style={{ animationDelay: '0.3s' }}>
            <div className="p-6 sm:p-8 pb-0">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <span className="text-2xl">📋</span> All {report.grid_size} Combinations
                </h3>
                <span className="text-xs text-slate-400">Click column headers to sort</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {[
                      { key: 'rank', label: '#' },
                      ...PARAM_KEYS.map(k => ({ key: k, label: PARAM_LABELS[k] })),
                      { key: 'gross_recovered', label: 'Gross ₹' },
                      { key: 'net_recovered', label: 'Net ₹' },
                      { key: 'recovery_rate_pct', label: 'Rate %' },
                      { key: 'cases_needing_approval', label: 'Approvals' },
                    ].map(col => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className="px-3 py-3 text-xs font-semibold text-slate-600 text-left cursor-pointer hover:text-slate-900 whitespace-nowrap select-none"
                      >
                        {col.label}{sortIcon(col.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleResults.map((r) => {
                    const best = isBestRow(r);
                    const defaults = isDefaultsRow(r);
                    return (
                      <tr
                        key={r.rank}
                        className={`border-b border-slate-100 transition-colors ${
                          best ? 'bg-amber-50 hover:bg-amber-100' :
                          defaults ? 'bg-blue-50 hover:bg-blue-100' :
                          'hover:bg-slate-50'
                        }`}
                      >
                        <td className="px-3 py-2.5 font-mono text-xs">
                          {best && <span className="mr-1">🏆</span>}
                          {defaults && <span className="mr-1">📌</span>}
                          {r.rank}
                        </td>
                        {PARAM_KEYS.map(k => (
                          <td key={k} className="px-3 py-2.5 font-mono text-xs text-slate-700">{r.thresholds[k]}</td>
                        ))}
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{formatCurrency(r.gross_recovered)}</td>
                        <td className={`px-3 py-2.5 font-mono text-xs font-semibold ${best ? 'text-amber-800' : 'text-slate-900'}`}>{formatCurrency(r.net_recovered)}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{formatPct(r.recovery_rate_pct)}</td>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{r.cases_needing_approval}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Show more / less */}
            {sortedResults.length > 20 && (
              <div className="p-4 text-center border-t border-slate-100">
                <button
                  onClick={() => setShowAllRows(!showAllRows)}
                  className="text-sm text-indigo-600 font-medium hover:text-indigo-800 transition-colors"
                >
                  {showAllRows ? `Show Top 20 ↑` : `Show All ${sortedResults.length} →`}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
