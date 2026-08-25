const express = require('express');
const router = express.Router();

// POST /api/approvals/:id/approve
router.post('/:id/approve', async (req, res) => {
  try {
    const { resolveApproval } = require('../orchestrator/caseOrchestrator');
    const result = await resolveApproval(req.params.id, true);
    res.json(result);
  } catch (error) {
    console.error('[Approvals] Error approving:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/approvals/:id/reject
router.post('/:id/reject', async (req, res) => {
  try {
    const { resolveApproval } = require('../orchestrator/caseOrchestrator');
    const result = await resolveApproval(req.params.id, false);
    res.json(result);
  } catch (error) {
    console.error('[Approvals] Error rejecting:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
