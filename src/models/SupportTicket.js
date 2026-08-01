const mongoose = require('mongoose');

const SUPPORT_CATEGORIES = [
  'Technical Issue',
  'Payment & Recharge',
  'Withdrawal Issue',
  'Profile Verification',
  'Profile Update',
  'Call Connection Problem',
  'Callback Issue',
  'Wallet Issue',
  'Referral & Rewards',
  'Account Restriction',
  'Bug Report',
  'Other',
];

const supportTicketSchema = new mongoose.Schema(
  {
    id: {type: String, required: true, unique: true, index: true},
    receiverId: {type: String, required: true, index: true},
    category: {
      type: String,
      enum: SUPPORT_CATEGORIES,
      required: true,
    },
    subject: {type: String, required: true, trim: true, maxlength: 120},
    description: {type: String, required: true, trim: true, maxlength: 500},
    mobile: {type: String, default: ''},
    email: {type: String, default: ''},
    attachments: {
      type: [
        {
          type: {type: String, enum: ['screenshot', 'document'], required: true},
          url: {type: String, required: true},
          name: {type: String, default: ''},
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['open', 'in_review', 'solved', 'closed'],
      default: 'open',
      index: true,
    },
  },
  {timestamps: true, collection: 'support_tickets'},
);

module.exports = {
  SupportTicket: mongoose.model('SupportTicket', supportTicketSchema),
  SUPPORT_CATEGORIES,
};
