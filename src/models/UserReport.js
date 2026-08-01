const mongoose = require('mongoose');
const crypto = require('crypto');

const userReportSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `RPT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    },
    reporterRole: {
      type: String,
      enum: ['caller', 'receiver'],
      required: true,
      index: true,
    },
    reporterId: {type: String, required: true, index: true},
    reportedRole: {
      type: String,
      enum: ['caller', 'receiver'],
      required: true,
      index: true,
    },
    reportedId: {type: String, required: true, index: true},
    conversationId: {type: String, default: null, index: true},
    reason: {type: String, required: true},
    details: {type: String, default: ''},
    status: {
      type: String,
      enum: ['open', 'ignored', 'resolved'],
      default: 'open',
      index: true,
    },
    adminAction: {
      type: String,
      enum: ['none', 'ignore', 'terminate'],
      default: 'none',
    },
    resolvedAt: {type: Date, default: null},
    resolvedByAdminId: {type: String, default: null},
  },
  {timestamps: true, collection: 'user_reports'},
);

module.exports = mongoose.model('UserReport', userReportSchema);
