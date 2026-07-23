/**
 * Idempotent demo accounts used for local / staging login.
 * Safe to call on every boot — only inserts when missing.
 */
const bcrypt = require('bcryptjs');
const {v4: uuidv4} = require('uuid');
const Admin = require('../models/Admin');

async function ensureDemoAdmin() {
  const email = 'admin@callkaro.com';
  const existing = await Admin.findOne({email});
  if (existing) {
    return {created: false, email};
  }

  const passwordHash = await bcrypt.hash('password123', 10);
  await Admin.create({
    id: uuidv4(),
    email,
    name: 'Callkaro Admin',
    phone: '',
    avatarUrl: '',
    passwordHash,
    isActive: true,
    twoFactorEnabled: true,
  });

  console.log('Demo admin ready:');
  console.log('  email:    admin@callkaro.com');
  console.log('  password: password123');
  return {created: true, email};
}

module.exports = {ensureDemoAdmin};
