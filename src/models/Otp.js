const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    email: {type: String, required: true, lowercase: true, trim: true, index: true},
    purpose: {
      type: String,
      required: true,
      enum: ['signup', 'forgot-password'],
    },
    otp: {type: String, required: true},
    expiresAt: {type: Date, required: true, index: true},
  },
  {timestamps: true},
);

otpSchema.index({email: 1, purpose: 1}, {unique: true});

module.exports = mongoose.model('Otp', otpSchema);
