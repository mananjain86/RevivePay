require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 5000;

// ──────────────────────────────────────────────────────────────────────
// CRITICAL MIDDLEWARE ORDERING:
// The webhook route MUST use raw body parsing for HMAC signature verification.
// Mount it BEFORE the global express.json() middleware, otherwise the global
// JSON parser will consume/reformat the body and signature checks will fail.
// ──────────────────────────────────────────────────────────────────────
const webhookRoutes = require('./routes/webhooks');
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

// Global middleware — applied to all other routes
app.use(cors());
app.use(express.json());

// API routes
const caseRoutes = require('./routes/cases');
const approvalRoutes = require('./routes/approvals');
const jobRoutes = require('./routes/jobs');

app.use('/api/cases', caseRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/jobs', jobRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', project: 'RevivePay — AI Recovery Desk for Payments at Risk' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Connect to MongoDB and start server
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('[MongoDB] Connected successfully');
    app.listen(PORT, () => {
      console.log(`[RevivePay] Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('[MongoDB] Connection failed:', err.message);
    process.exit(1);
  });

module.exports = app;
