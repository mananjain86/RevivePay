const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Case = require('../models/Case');
const ProcessedWebhookEvent = require('../models/ProcessedWebhookEvent');

// POST /api/webhooks/razorpay
// NOTE: This route receives raw body (express.raw) — mounted before global express.json() in server.js
router.post('/razorpay', async (req, res) => {
  try {
    console.log('[Webhook] Received POST /api/webhooks/razorpay');
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      console.error(`[Webhook] Missing data! Signature present: ${!!signature}, Secret present: ${!!webhookSecret}`);
      return res.status(400).json({ error: 'Missing signature or webhook secret' });
    }

    // 1. Verify HMAC-SHA256 signature against raw body
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.body) // req.body is a Buffer because of express.raw()
      .digest('hex');

    if (expectedSignature !== signature) {
      console.warn('[Webhook] Signature mismatch — rejecting');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // Parse the verified raw body
    const event = JSON.parse(req.body.toString());
    const eventId = req.headers['x-razorpay-event-id'];

    if (!eventId) {
      console.error('[Webhook] Missing x-razorpay-event-id header!');
      return res.status(400).json({ error: 'Missing event ID' });
    }

    // 2. Dedup check — prevent double-counting recovered revenue
    const existing = await ProcessedWebhookEvent.findOne({ razorpay_event_id: eventId });
    if (existing) {
      // Already processed — return 200 immediately without reprocessing
      return res.status(200).json({ status: 'already_processed' });
    }

    // 3. Record this event as processed
    await ProcessedWebhookEvent.create({ razorpay_event_id: eventId });

    // 4. Handle event types
    const eventType = event.event;
    const paymentLinkEntity = event.payload?.payment_link?.entity;

    if (!paymentLinkEntity) {
      return res.status(200).json({ status: 'no_payment_link_entity' });
    }

    const linkId = paymentLinkEntity.id;

    if (eventType === 'payment_link.paid') {
      // Find case by razorpay_reference and mark as recovered
      const caseDoc = await Case.findOne({ 'execution.razorpay_reference': linkId });
      if (caseDoc) {
        caseDoc.execution.payment_link_status = 'paid';
        caseDoc.status = 'recovered';
        caseDoc.audit_log.push({
          stage: 'webhook_payment_confirmed',
          timestamp: new Date(),
          output: { event_type: eventType, payment_link_id: linkId, status: 'recovered' }
        });
        await caseDoc.save();
        console.log(`[Webhook] Case ${caseDoc._id} → recovered (payment_link.paid)`);
      }
    } else if (eventType === 'payment_link.expired' || eventType === 'payment_link.cancelled') {
      // Customer didn't pay — this is NOT an execution failure
      const caseDoc = await Case.findOne({ 'execution.razorpay_reference': linkId });
      if (caseDoc) {
        caseDoc.execution.payment_link_status = eventType === 'payment_link.expired' ? 'expired' : 'cancelled';
        caseDoc.status = 'unrecovered_expired'; // distinct from execution_failed
        caseDoc.audit_log.push({
          stage: 'webhook_payment_not_completed',
          timestamp: new Date(),
          output: { event_type: eventType, payment_link_id: linkId, status: 'unrecovered_expired' }
        });
        await caseDoc.save();
        console.log(`[Webhook] Case ${caseDoc._id} → unrecovered_expired (${eventType})`);
      }
    }

    // 5. Return 200 quickly (Razorpay retries on non-2xx)
    res.status(200).json({ status: 'processed' });
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);
    // Still return 200 to prevent Razorpay from retrying on our errors
    res.status(200).json({ status: 'error', message: error.message });
  }
});

module.exports = router;
