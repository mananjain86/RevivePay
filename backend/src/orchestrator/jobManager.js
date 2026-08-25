/**
 * jobManager.js — In-memory background job tracking for batch runs.
 *
 * No Bull/Redis needed — just an in-memory Map of jobId → status.
 * Processes cases in chunks of 5 concurrently to respect Gemini/Razorpay rate limits.
 * Uses atomic case claiming (status: "new" → "processing") to prevent double-processing.
 */

const Case = require('../models/Case');
const { processCase } = require('./caseOrchestrator');
const crypto = require('crypto');

// In-memory job store
const jobs = new Map();

/**
 * Start a batch job that processes all "new" cases.
 *
 * Returns a jobId immediately — processing happens in the background.
 * Frontend polls GET /api/jobs/:jobId for progress updates.
 *
 * @returns {Promise<string>} jobId
 */
async function startBatchJob() {
  const jobId = `job_${crypto.randomBytes(4).toString('hex')}`;

  // Count cases that need processing
  const caseIds = await Case.find({ status: 'new' }).select('_id').lean();
  const total = caseIds.length;

  if (total === 0) {
    jobs.set(jobId, { status: 'completed', total: 0, completed: 0, failed: 0, skipped: 0 });
    return jobId;
  }

  jobs.set(jobId, { status: 'running', total, completed: 0, failed: 0, skipped: 0 });

  // Process in background (don't await)
  processBatch(jobId, caseIds.map(c => c._id)).catch(err => {
    console.error(`[JobManager] Fatal error in batch ${jobId}:`, err);
    const job = jobs.get(jobId);
    if (job) job.status = 'failed';
  });

  return jobId;
}

/**
 * Process a batch of case IDs in chunks of 5.
 */
async function processBatch(jobId, caseIds) {
  const CHUNK_SIZE = 5;
  const job = jobs.get(jobId);

  for (const caseId of caseIds) {
    try {
      const result = await processCase(caseId);
      if (result === null) {
        job.skipped++;
      } else {
        job.completed++;
      }
    } catch (error) {
      job.failed++;
      console.error(`[JobManager] Case failed:`, error);
    }
    // Delay of 2 seconds between cases to avoid Gemini free-tier burst limits
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  job.status = 'completed';
  console.log(`[JobManager] Batch ${jobId} completed: ${job.completed} processed, ${job.skipped} skipped, ${job.failed} failed`);
}

/**
 * Get the current status of a batch job.
 *
 * @param {string} jobId
 * @returns {object|null} { status, total, completed, failed, skipped }
 */
function getJobStatus(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = { startBatchJob, getJobStatus };
