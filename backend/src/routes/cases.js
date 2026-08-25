const express = require('express');
const router = express.Router();

// GET /api/cases — all cases, supports ?status= filter
router.get('/', async (req, res) => {
  try {
    const Case = require('../models/Case');
    const filter = {};
    if (req.query.status) {
      filter.status = req.query.status;
    }
    const cases = await Case.find(filter).sort({ updatedAt: -1 });
    res.json(cases);
  } catch (error) {
    console.error('[Cases] Error fetching cases:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cases/summary — aggregate stats (dual metrics: simulated vs verified)
router.get('/summary', async (req, res) => {
  try {
    const Case = require('../models/Case');
    const allCases = await Case.find({});

    // Separate simulated vs real (razorpay) cases
    const simulated = allCases.filter(c => !c.demo_case || c.execution?.executor_type === 'simulated');
    const real = allCases.filter(c => c.demo_case && c.execution?.executor_type === 'razorpay');

    const totalAtRisk = allCases.reduce((sum, c) => sum + c.amount, 0);

    // Simulated batch metrics
    const simRecovered = simulated
      .filter(c => c.status === 'recovered')
      .reduce((sum, c) => sum + c.amount, 0);
    const simAtRisk = simulated.reduce((sum, c) => sum + c.amount, 0);

    // Verified real-money metrics (webhook-confirmed only)
    const realRecovered = real
      .filter(c => c.status === 'recovered')
      .reduce((sum, c) => sum + c.amount, 0);
    const realTotal = real.length;
    const realPaid = real.filter(c => c.status === 'recovered').length;

    // Status counts
    const statusCounts = {};
    allCases.forEach(c => {
      statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    });

    res.json({
      total_cases: allCases.length,
      total_at_risk: totalAtRisk,
      simulated: {
        at_risk: simAtRisk,
        recovered: simRecovered,
        case_count: simulated.length,
        recovery_rate: simAtRisk > 0 ? ((simRecovered / simAtRisk) * 100).toFixed(1) : '0.0'
      },
      verified: {
        recovered: realRecovered,
        total_demo_cases: realTotal,
        paid_count: realPaid
      },
      status_counts: statusCounts
    });
  } catch (error) {
    console.error('[Cases] Error fetching summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/cases/:id — single case with full audit_log
router.get('/:id', async (req, res) => {
  try {
    const Case = require('../models/Case');
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) return res.status(404).json({ error: 'Case not found' });
    res.json(caseDoc);
  } catch (error) {
    console.error('[Cases] Error fetching case:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cases/run-batch — triggers batch processing
router.post('/run-batch', async (req, res) => {
  try {
    const { startBatchJob } = require('../orchestrator/jobManager');
    const jobId = await startBatchJob();
    res.json({ jobId });
  } catch (error) {
    console.error('[Cases] Error starting batch:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/cases/reset — reset all cases back to 'new' status for testing
router.post('/reset', async (req, res) => {
  try {
    const Case = require('../models/Case');
    const ProcessedWebhookEvent = require('../models/ProcessedWebhookEvent');
    
    // Reset all cases to 'new' status and clear processing data
    const result = await Case.updateMany(
      {},
      {
        $set: {
          status: 'new',
          diagnosis: null,
          value_assessment: null,
          plan: null,
          policy_check: null,
          execution: null,
          audit_log: [],
          contact_count: 0
        }
      }
    );
    
    // Clear webhook events so demo cases can be paid again
    await ProcessedWebhookEvent.deleteMany({});
    
    console.log(`[Cases] Reset ${result.modifiedCount} cases back to 'new' status`);
    res.json({ 
      success: true, 
      reset_count: result.modifiedCount,
      message: 'All cases reset to new status'
    });
  } catch (error) {
    console.error('[Cases] Error resetting cases:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
