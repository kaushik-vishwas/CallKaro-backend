const express = require('express');
const authRoutes = require('./auth/auth.routes');
const profileRoutes = require('./profile/profile.routes');
const walletRoutes = require('./wallet/wallet.routes');
const agentRoutes = require('./agent/agent.routes');
const receiverRoutes = require('./receiver/receiver.routes');
const {createStubRouter} = require('./createStubRouter');

/**
 * Compatibility router — same paths the mobile app already uses (/api/caller/*).
 * Domains are split into modules; paths stay stable for Render ↔ local switching.
 */
function createCallerCompatibilityRouter() {
  const router = express.Router();

  router.use(authRoutes);
  router.use(profileRoutes);
  router.use(walletRoutes);

  return router;
}

function registerModuleRoutes(app) {
  // Existing mobile contract
  app.use('/api/caller', createCallerCompatibilityRouter());

  // Agent panel
  app.use('/api/agent', agentRoutes);

  // Future-facing module mounts (stubs until built)
  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/receiver', receiverRoutes);
  app.use('/api/chat', createStubRouter('chat'));
  app.use('/api/calls', createStubRouter('calls'));
  app.use('/api/notifications', createStubRouter('notifications'));
  app.use('/api/uploads', require('./uploads/uploads.routes'));
  app.use('/api/admin', require('./admin/admin.routes'));
}

module.exports = {registerModuleRoutes, createCallerCompatibilityRouter};
