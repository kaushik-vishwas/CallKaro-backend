const mongoose = require('mongoose');
const crypto = require('crypto');

/** Unique profile view per caller → receiver per calendar day (UTC). */
const profileViewSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => crypto.randomUUID(),
    },
    callerId: {type: String, required: true, index: true},
    receiverId: {type: String, required: true, index: true},
    dayKey: {type: String, required: true, index: true},
  },
  {timestamps: true, collection: 'profile_views'},
);

profileViewSchema.index(
  {callerId: 1, receiverId: 1, dayKey: 1},
  {unique: true},
);

module.exports = mongoose.model('ProfileView', profileViewSchema);
