const mongoose = require('mongoose');

/**
 * Agent = web panel user who onboards and manages receivers.
 */
const agentSchema = new mongoose.Schema(
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
    agentCode: {type: String, required: true, unique: true, trim: true},
    avatarUrl: {type: String, default: ''},
    passwordHash: {type: String, required: true},
    isActive: {type: Boolean, default: true},
  },
  {timestamps: true, collection: 'agents'},
);

module.exports = mongoose.model('Agent', agentSchema);
