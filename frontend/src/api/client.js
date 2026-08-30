/**
 * API client — fetch wrappers for all backend endpoints.
 */

const envUrl = import.meta.env.VITE_API_URL || '';
const API_BASE = envUrl ? (envUrl.endsWith('/api') ? envUrl : envUrl.replace(/\/$/, '') + '/api') : '/api';

async function fetchJSON(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(error.message || error.error || 'Request failed');
  }
  return res.json();
}

// Cases
export const getCases = (status) =>
  fetchJSON(status ? `/cases?status=${status}` : '/cases');

export const getCaseById = (id) =>
  fetchJSON(`/cases/${id}`);

export const getSummary = () =>
  fetchJSON('/cases/summary');

export const runBatch = () =>
  fetchJSON('/cases/run-batch', { method: 'POST' });

export const resetCases = () =>
  fetchJSON('/cases/reset', { method: 'POST' });

// Approvals
export const approveCase = (id) =>
  fetchJSON(`/approvals/${id}/approve`, { method: 'POST' });

export const rejectCase = (id) =>
  fetchJSON(`/approvals/${id}/reject`, { method: 'POST' });

// Jobs
export const getJobStatus = (jobId) =>
  fetchJSON(`/jobs/${jobId}`);

// Sweep
export const runSweep = () =>
  fetchJSON('/sweep/run', { method: 'POST' });

export const getSweepResults = () =>
  fetchJSON('/sweep/results');

export const applySweepWinner = (thresholds) =>
  fetchJSON('/sweep/apply', { method: 'POST', body: JSON.stringify(thresholds) });

export const revertThresholds = () =>
  fetchJSON('/sweep/revert', { method: 'POST' });

export const getActiveConfig = () =>
  fetchJSON('/sweep/active-config');

export const getPreApplySummary = () =>
  fetchJSON('/sweep/pre-apply-summary');

// Bandit
export const getBanditScoreboard = () =>
  fetchJSON('/bandit/scoreboard');

export const resetBandit = () =>
  fetchJSON('/bandit/reset', { method: 'POST' });

export const runABComparison = (numCases = 200, batchSize = 20, seed = 42) =>
  fetchJSON(`/bandit/ab-comparison?num_cases=${numCases}&batch_size=${batchSize}&seed=${seed}`, { method: 'POST' });
