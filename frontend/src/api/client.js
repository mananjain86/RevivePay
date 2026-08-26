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
