const mongoose = require('mongoose');

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
  },
  {timestamps: true, collection: 'admins'},
);

module.exports = mongoose.model('Admin', adminSchema);
