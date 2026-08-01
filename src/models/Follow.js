const mongoose = require('mongoose');
const crypto = require('crypto');

const followSchema = new mongoose.Schema(
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
  },
  {timestamps: true, collection: 'follows'},
);

followSchema.index({callerId: 1, receiverId: 1}, {unique: true});

module.exports = mongoose.model('Follow', followSchema);
