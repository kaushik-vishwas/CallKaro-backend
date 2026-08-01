const Follow = require('../models/Follow');
const ProfileView = require('../models/ProfileView');
const Receiver = require('../models/Receiver');
const crypto = require('crypto');

function isDuplicateKey(error) {
  return Boolean(error && (error.code === 11000 || error.code === 11001));
}

async function syncFollowerCount(receiverId) {
  const count = await Follow.countDocuments({receiverId});
  await Receiver.updateOne(
    {id: receiverId},
    {$set: {followers: count}},
  );
  return count;
}

async function getReceiverOrFail(receiverId) {
  const receiver = await Receiver.findOne({
    id: receiverId,
    status: 'active',
  }).lean();
  if (!receiver) {
    const err = new Error('Receiver not found.');
    err.statusCode = 404;
    throw err;
  }
  return receiver;
}

async function followReceiver(callerId, receiverId) {
  await getReceiverOrFail(receiverId);
  try {
    await Follow.create({
      id: crypto.randomUUID(),
      callerId: String(callerId),
      receiverId: String(receiverId),
    });
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error;
    }
  }
  const followers = await syncFollowerCount(String(receiverId));
  return {following: true, followers};
}

async function unfollowReceiver(callerId, receiverId) {
  await getReceiverOrFail(receiverId);
  await Follow.deleteOne({
    callerId: String(callerId),
    receiverId: String(receiverId),
  });
  const followers = await syncFollowerCount(String(receiverId));
  return {following: false, followers};
}

async function recordProfileView(callerId, receiverId) {
  const receiver = await getReceiverOrFail(receiverId);
  const dayKey = new Date().toISOString().slice(0, 10);
  let counted = false;
  try {
    await ProfileView.create({callerId, receiverId, dayKey});
    counted = true;
    await Receiver.updateOne({id: receiverId}, {$inc: {profileViews: 1}});
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error;
    }
  }
  const fresh = await Receiver.findOne({id: receiverId})
    .select('profileViews followers')
    .lean();
  return {
    counted,
    profileViews: Math.max(
      0,
      Number(fresh?.profileViews ?? receiver.profileViews) || 0,
    ),
    followers: Math.max(0, Number(fresh?.followers ?? receiver.followers) || 0),
  };
}

async function getFollowingReceiverIds(callerId, receiverIds = []) {
  if (!callerId || !receiverIds.length) {
    return new Set();
  }
  const rows = await Follow.find({
    callerId,
    receiverId: {$in: receiverIds},
  })
    .select('receiverId')
    .lean();
  return new Set(rows.map(row => row.receiverId));
}

module.exports = {
  followReceiver,
  unfollowReceiver,
  recordProfileView,
  getFollowingReceiverIds,
  syncFollowerCount,
};
