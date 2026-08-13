const mongoose = require('mongoose');

const bankSchema = new mongoose.Schema(
  {
    accountHolder: {type: String, default: ''},
    bankName: {type: String, default: ''},
    iban: {type: String, default: ''},
    swift: {type: String, default: ''},
    branchName: {type: String, default: ''},
    country: {type: String, default: 'India'},
    accountType: {
      type: String,
      enum: ['savings', 'current'],
      default: 'savings',
    },
    verified: {type: Boolean, default: false},
    updatedAt: {type: Date, default: null},
    reference: {type: String, default: ''},
  },
  {_id: false},
);

/**
 * Admin = Callkaro admin panel user (superuser).
 */
const adminSchema = new mongoose.Schema(
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
    avatarUrl: {type: String, default: ''},
    passwordHash: {type: String, required: true},
    isActive: {type: Boolean, default: true},
    twoFactorEnabled: {type: Boolean, default: true},
    passwordChangedAt: {type: Date, default: null},
    lastLoginAt: {type: Date, default: null},
    bank: {type: bankSchema, default: () => ({})},
  },
  {timestamps: true, collection: 'admins'},
);

module.exports = mongoose.model('Admin', adminSchema);
