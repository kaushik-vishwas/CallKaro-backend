/**
 * Seed demo Caller + Agent + Admin (+ optional sample receivers).
 *
 * Caller:  demo@callkaro.local / password123
 * Agent:   agent@callkaro.com / password123
 * Admin:   admin@callkaro.com / password123
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const {v4: uuidv4} = require('uuid');
const {connectMongo} = require('../db/connect');
const Caller = require('../models/Caller');
const Agent = require('../models/Agent');
const Receiver = require('../models/Receiver');
const {ensureDemoAdmin} = require('../bootstrap/ensureDemoAdmin');

async function ensureCaller() {
  const email = 'demo@callkaro.local';
  const existing = await Caller.findOne({email});
  if (existing) {
    console.log('Demo caller already exists:', email);
    return existing;
  }

  const passwordHash = await bcrypt.hash('password123', 10);
  const caller = await Caller.create({
    id: uuidv4(),
    email,
    name: 'Demo Caller',
    phone: '',
    profile: '',
    avatarUrl: '',
    passwordHash,
    coins: 2500,
    isVerified: true,
  });

  console.log('Seeded demo caller:');
  console.log('  email:    demo@callkaro.local');
  console.log('  password: password123');
  return caller;
}

async function ensureAgent() {
  const email = 'agent@callkaro.com';
  const existing = await Agent.findOne({email});
  if (existing) {
    console.log('Demo agent already exists:', email);
    return existing;
  }

  const passwordHash = await bcrypt.hash('password123', 10);
  const agent = await Agent.create({
    id: uuidv4(),
    email,
    name: 'Rahul Verma',
    phone: '+91 98765 43210',
    agentCode: 'AGT101',
    avatarUrl: '',
    passwordHash,
    isActive: true,
  });

  console.log('Seeded demo agent:');
  console.log('  email:    agent@callkaro.com');
  console.log('  password: password123');
  return agent;
}

async function ensureSampleReceivers(agent) {
  const count = await Receiver.countDocuments({agentId: agent.id});
  if (count > 0) {
    console.log(`Agent already has ${count} receiver(s) — skipping samples`);
    return;
  }

  const passwordHash = await bcrypt.hash('temp@demo', 10);
  const photos = [
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
    'https://images.unsplash.com/photo-1529626455594-64432c78bfcd?w=200&h=200&fit=crop',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
  ];
  const docThumb =
    'https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=120&h=160&fit=crop';
  const docs = [
    {id: 'aadhaar', title: 'Aadhaar Card', sizeLabel: '523 kb', thumbnail: docThumb, url: ''},
    {id: 'pan', title: 'PAN Card', sizeLabel: '412 kb', thumbnail: docThumb, url: ''},
    {id: 'passbook', title: 'Bank Passbook', sizeLabel: '680 kb', thumbnail: docThumb, url: ''},
  ];

  const samples = [
    {
      id: 'RCV-SAMPLE1',
      name: 'Priya Sharma',
      age: 24,
      gender: 'female',
      level: 2,
      status: 'pending_review',
      totalHours: 142,
      earnings: 24680,
      totalCalls: 210,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      id: 'RCV-SAMPLE2',
      name: 'Ananya Patel',
      age: 26,
      gender: 'female',
      level: 3,
      status: 'pending_review',
      totalHours: 198,
      earnings: 38230,
      totalCalls: 320,
      submittedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    },
    {
      id: 'RCV-SAMPLE3',
      name: 'Kavya Reddy',
      age: 22,
      gender: 'female',
      level: 1,
      status: 'active',
      totalHours: 87,
      earnings: 12450,
      totalCalls: 140,
      activatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      submittedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    },
  ];

  for (const sample of samples) {
    const slug = sample.name.toLowerCase().replace(/\s+/g, '');
    await Receiver.create({
      ...sample,
      agentId: agent.id,
      onboardingToken: crypto.randomBytes(16).toString('hex'),
      loginEmail: `${slug}@callkaro.com`,
      temporaryPassword: `${slug}@callkaro`,
      passwordHash,
      bio: 'Friendly and energetic conversationalist who loves music and travel stories.',
      languages: ['Hindi', 'English'],
      photos,
      bank: {
        holderName: sample.name,
        accountNumber: 'XXXXXX4821',
        ifsc: 'HDFC0001234',
        upiId: `${slug}@upi`,
      },
      kyc: {
        videoUrl: '',
        videoThumb: photos[0],
        documents: docs,
      },
    });
  }

  console.log(`Seeded ${samples.length} sample receivers for agent`);
}

async function seed() {
  await connectMongo();
  await ensureCaller();
  const agent = await ensureAgent();
  await ensureDemoAdmin();
  await ensureSampleReceivers(agent);
  process.exit(0);
}

seed().catch(error => {
  console.error(error);
  process.exit(1);
});
