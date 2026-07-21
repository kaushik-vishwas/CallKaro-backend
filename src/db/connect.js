const mongoose = require('mongoose');
const {config} = require('../config');

async function connectMongo() {
  if (!config.mongoUri) {
    throw new Error('MONGODB_URI is missing. Set it in backend/.env');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');
}

module.exports = {connectMongo};
