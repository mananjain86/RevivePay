const mongoose = require('mongoose');

const processedWebhookEventSchema = new mongoose.Schema({
  razorpay_event_id: {
    type: String,
    required: true,
    unique: true
  },
  processed_at: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ProcessedWebhookEvent', processedWebhookEventSchema);
