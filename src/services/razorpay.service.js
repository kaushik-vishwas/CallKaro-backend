const Razorpay = require('razorpay');
const {config} = require('../config');

let client = null;

function getRazorpay() {
  if (!config.razorpayKeyId || !config.razorpayKeySecret) {
    throw new Error('Razorpay keys are not configured.');
  }
  if (
    config.razorpayKeyId.includes('local_key') ||
    config.razorpayKeySecret.includes('local_secret')
  ) {
    throw new Error(
      'Replace RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET with real Razorpay keys.',
    );
  }
  if (!client) {
    client = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpayKeySecret,
    });
  }
  return client;
}

async function createRazorpayOrder({
  amountPaise,
  currency = 'INR',
  receipt,
  notes = {},
}) {
  const rzp = getRazorpay();
  const order = await rzp.orders.create({
    amount: amountPaise,
    currency,
    receipt: String(receipt || `rcpt_${Date.now()}`).slice(0, 40),
    notes,
  });
  return order;
}

module.exports = {
  getRazorpay,
  createRazorpayOrder,
};
