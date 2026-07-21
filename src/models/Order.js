const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    id: {type: String, required: true, unique: true, index: true},
    userId: {type: String, required: true, index: true},
    amount: {type: Number, required: true},
    amountPaise: {type: Number, required: true},
    coins: {type: Number, required: true},
    currency: {type: String, default: 'INR'},
    status: {
      type: String,
      enum: ['created', 'paid', 'failed'],
      default: 'created',
    },
    razorpayPaymentId: {type: String, default: null},
    razorpaySignature: {type: String, default: null},
    paidAt: {type: Date, default: null},
  },
  {timestamps: true},
);

module.exports = mongoose.model('Order', orderSchema);
