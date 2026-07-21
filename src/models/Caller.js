const mongoose = require('mongoose');

/**
 * Caller = end-user of the mobile caller app (formerly User).
 * Collection: callers
 */
const callerSchema = new mongoose.Schema(
  {
    id: {type: String, required: true, unique: true, index: true},
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {type: String, required: true, trim: true},
    phone: {type: String, default: ''},
    profile: {type: String, default: ''},
    avatarUrl: {type: String, default: ''},
    passwordHash: {type: String, required: true},
    coins: {type: Number, default: 0},
    isVerified: {type: Boolean, default: false},
  },
  {timestamps: true, collection: 'callers'},
);

module.exports = mongoose.model('Caller', callerSchema);
