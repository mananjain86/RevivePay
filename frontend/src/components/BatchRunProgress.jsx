import { useState, useEffect, useRef } from 'react';
import { runBatch, getJobStatus, resetCases } from '../api/client';

export default function BatchRunProgress({ onComplete }) {
  const [jobId, setJobId] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function startBatch() {
    try {
      setStarting(true);
      setError(null);
      const { jobId: id } = await runBatch();
      setJobId(id);
      setJob({ status: 'running', total: 0, completed: 0, failed: 0, skipped: 0 });

      intervalRef.current = setInterval(async () => {
        try {
          const status = await getJobStatus(id);
          setJob(status);
          if (status.status === 'completed' || status.status === 'failed') {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
            onComplete?.();
          }
        } catch (err) {
          console.error('Failed to get job status:', err);
        }
      }, 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  function reset() {
    setJobId(null);
    setJob(null);
    setError(null);
  }

  async function handleReset() {
    if (!confirm('Reset all cases back to "new" status? This will clear all processing results.')) {
      return;
    }
    try {
      setResetting(true);
      setError(null);
      await resetCases();
      reset();
      onComplete?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  }

  const isRunning = job?.status === 'running';
  const isDone = job?.status === 'completed';
  const progress = job?.total > 0 
    ? ((job.completed + (job.skipped || 0) + (job.failed || 0)) / job.total) * 100 
    : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      {!jobId ? (
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-1">Batch Processing</h3>
            <p className="text-sm text-slate-600">
              Process all new cases through the AI recovery pipeline
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={handleReset}
              disabled={resetting}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-100 text-slate-700 disabled:text-slate-400 font-semibold text-sm rounded-xl shadow-sm hover:shadow hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:cursor-not-allowed disabled:transform-none"
            >
              {resetting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Resetting...
                </>
              ) : (
                <>
                  <span>🔄</span>
                  Reset All
                </>
              )}
            </button>
            <button 
              onClick={startBatch} 
              disabled={starting} 
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold text-sm rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:cursor-not-allowed disabled:transform-none"
            >
              {starting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Starting...
                </>
              ) : (
                <>
                  <span>▶</span>
                  Run Batch
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {isRunning && <div className="w-2 h-2 rounded-full bg-blue-500 pulse-dot" />}
              {isDone && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
              <h3 className="text-base font-bold text-slate-900">
                {isRunning ? 'Processing...' : isDone ? 'Batch Complete' : 'Failed'}
              </h3>
            </div>
            <span className="font-mono text-sm font-semibold text-slate-600">
              {job.completed + (job.skipped || 0)} / {job.total}
            </span>
          </div>

          <div className="h-2 bg-slate-200 rounded-full overflow-hidden mb-4">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                isDone 
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' 
                  : 'bg-gradient-to-r from-blue-500 to-blue-600'
              }`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>

          <div className="flex items-center gap-6 text-sm">
            <span className="text-emerald-600 font-medium">
              ✓ {job.completed} processed
            </span>
            {(job.skipped || 0) > 0 && (
              <span className="text-slate-500 font-medium">
                ⊘ {job.skipped} skipped
              </span>
            )}
            {(job.failed || 0) > 0 && (
              <span className="text-red-600 font-medium">
                ✕ {job.failed} failed
              </span>
            )}
            {isDone && (
              <button
                onClick={reset}
                className="ml-auto text-blue-600 hover:text-blue-700 font-semibold text-sm transition-colors"
              >
                New Run →
              </button>
            )}
          </div>
        </div>
      )}
      
      {error && (
        <p className="text-sm text-red-600 mt-3 font-medium">Error: {error}</p>
      )}
    </div>
  );
}
