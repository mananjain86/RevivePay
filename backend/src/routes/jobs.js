const express = require('express');
const router = express.Router();

// GET /api/jobs/:jobId — returns current job status for polling
router.get('/:jobId', (req, res) => {
  try {
    const { getJobStatus } = require('../orchestrator/jobManager');
    const status = getJobStatus(req.params.jobId);
    if (!status) return res.status(404).json({ error: 'Job not found' });
    res.json(status);
  } catch (error) {
    console.error('[Jobs] Error fetching job status:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
