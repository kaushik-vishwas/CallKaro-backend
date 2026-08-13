const mongoose = require('mongoose');
const crypto = require('crypto');

const REPORT_STATUSES = [
  'open',
  'assigned',
  'agent_accepted',
  'agent_ignored',
  'ignored',
  'resolved',
  'under_appeal',
];

const REPORT_SOURCES = ['chat', 'identity_mismatch', 'in_call'];

const userReportSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `RPT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    },
    caseCode: {type: String, default: '', index: true},
    source: {
      type: String,
      enum: REPORT_SOURCES,
      default: 'chat',
      index: true,
    },
    callId: {type: String, default: null, index: true},
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
    detectionType: {type: String, default: ''},
    status: {
      type: String,
      enum: REPORT_STATUSES,
      default: 'open',
      index: true,
    },
    adminAction: {
      type: String,
      enum: ['none', 'ignore', 'terminate', 'assign', 'escalate'],
      default: 'none',
    },
    assignedAgentId: {type: String, default: null, index: true},
    assignedAt: {type: Date, default: null},
    assignmentNote: {type: String, default: ''},
    riskScore: {type: Number, default: null},
    timeline: {
      type: [
        {
          id: String,
          title: String,
          actor: String,
          at: Date,
        },
      ],
      default: [],
    },
    resolvedAt: {type: Date, default: null},
    resolvedByAdminId: {type: String, default: null},
    autoBlockAt: {type: Date, default: null},
  },
  {timestamps: true, collection: 'user_reports'},
);

userReportSchema.index({source: 1, status: 1, createdAt: -1});

module.exports = mongoose.model('UserReport', userReportSchema);
module.exports.REPORT_STATUSES = REPORT_STATUSES;
module.exports.REPORT_SOURCES = REPORT_SOURCES;
