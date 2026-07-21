const {ok, fail} = require('../utils/response');
const {signToken} = require('../middleware/auth');
const agentService = require('../services/agent.service');

async function login(req, res) {
  try {
    const {email, password} = req.body || {};
    if (!email || !password) {
      return fail(res, 'Email and password are required.');
    }
    const result = await agentService.login(email, password);
    if (!result.ok) {
      return fail(res, result.message, 401);
    }
    const token = signToken(result.agent, {role: 'agent'});
    return ok(
      res,
      {
        token,
        agent: agentService.publicAgent(result.agent),
      },
      'Login successful',
    );
  } catch (error) {
    console.error('[agent.login]', error);
    return fail(res, 'Login failed.', 500);
  }
}

async function me(req, res) {
  try {
    const agent = await agentService.findAgentById(req.auth.agentId);
    if (!agent) return fail(res, 'Agent not found.', 404);
    return ok(res, {agent: agentService.publicAgent(agent)}, 'Agent fetched');
  } catch (error) {
    console.error('[agent.me]', error);
    return fail(res, 'Failed to fetch agent.', 500);
  }
}

async function updateProfile(req, res) {
  try {
    const agent = await agentService.updateProfile(req.auth.agentId, req.body || {});
    if (!agent) return fail(res, 'Agent not found.', 404);
    return ok(
      res,
      {agent: agentService.publicAgent(agent)},
      'Profile updated',
    );
  } catch (error) {
    console.error('[agent.updateProfile]', error);
    return fail(res, 'Failed to update profile.', 500);
  }
}

async function updatePassword(req, res) {
  try {
    const {currentPassword, newPassword} = req.body || {};
    if (!currentPassword || !newPassword) {
      return fail(res, 'currentPassword and newPassword are required.');
    }
    if (String(newPassword).length < 6) {
      return fail(res, 'New password must be at least 6 characters.');
    }
    const result = await agentService.updatePassword(
      req.auth.agentId,
      currentPassword,
      newPassword,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(res, {}, 'Password updated');
  } catch (error) {
    console.error('[agent.updatePassword]', error);
    return fail(res, 'Failed to update password.', 500);
  }
}

async function createReceiver(req, res) {
  try {
    const {name, age, gender, level, asDraft} = req.body || {};
    const result = await agentService.createReceiver(req.auth.agentId, {
      name,
      age,
      gender,
      level,
      asDraft: Boolean(asDraft),
    });
    if (!result.ok) return fail(res, result.message, 400);

    return ok(
      res,
      {
        receiver: await agentService.publicReceiverProfile(result.receiver),
        onboardingLink: result.onboardingLink,
      },
      asDraft ? 'Receiver saved as draft' : 'Receiver created',
      201,
    );
  } catch (error) {
    console.error('[agent.createReceiver]', error);
    return fail(res, 'Failed to create receiver.', 500);
  }
}

async function listReceivers(req, res) {
  try {
    const receivers = await agentService.listReceivers(req.auth.agentId, {
      status: req.query.status,
      q: req.query.q,
    });
    return ok(res, {receivers}, 'Receivers fetched');
  } catch (error) {
    console.error('[agent.listReceivers]', error);
    return fail(res, 'Failed to list receivers.', 500);
  }
}

async function receiverStats(req, res) {
  try {
    const stats = await agentService.getReceiverStats(req.auth.agentId);
    return ok(res, stats, 'Stats fetched');
  } catch (error) {
    console.error('[agent.receiverStats]', error);
    return fail(res, 'Failed to fetch stats.', 500);
  }
}

async function listPending(req, res) {
  try {
    const pending = await agentService.listPending(req.auth.agentId);
    return ok(res, {pending}, 'Pending approvals fetched');
  } catch (error) {
    console.error('[agent.listPending]', error);
    return fail(res, 'Failed to list pending approvals.', 500);
  }
}

async function getReceiver(req, res) {
  try {
    const receiver = await agentService.getReceiverForAgent(
      req.auth.agentId,
      req.params.id,
    );
    if (!receiver) return fail(res, 'Receiver not found.', 404);
    return ok(
      res,
      {receiver: await agentService.publicReceiverProfile(receiver)},
      'Receiver fetched',
    );
  } catch (error) {
    console.error('[agent.getReceiver]', error);
    return fail(res, 'Failed to fetch receiver.', 500);
  }
}

async function approveReceiver(req, res) {
  try {
    const result = await agentService.approveReceiver(
      req.auth.agentId,
      req.params.id,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await agentService.publicReceiverProfile(result.receiver)},
      'Receiver approved',
    );
  } catch (error) {
    console.error('[agent.approveReceiver]', error);
    return fail(res, 'Failed to approve receiver.', 500);
  }
}

async function rejectReceiver(req, res) {
  try {
    const {reason} = req.body || {};
    const result = await agentService.rejectReceiver(
      req.auth.agentId,
      req.params.id,
      reason,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await agentService.publicReceiverProfile(result.receiver)},
      'Receiver rejected',
    );
  } catch (error) {
    console.error('[agent.rejectReceiver]', error);
    return fail(res, 'Failed to reject receiver.', 500);
  }
}

async function requestChanges(req, res) {
  try {
    const {note} = req.body || {};
    const result = await agentService.requestChanges(
      req.auth.agentId,
      req.params.id,
      note,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await agentService.publicReceiverProfile(result.receiver)},
      'Changes requested',
    );
  } catch (error) {
    console.error('[agent.requestChanges]', error);
    return fail(res, 'Failed to request changes.', 500);
  }
}

async function terminateReceiver(req, res) {
  try {
    const {reason} = req.body || {};
    const result = await agentService.setReceiverStatus(
      req.auth.agentId,
      req.params.id,
      'inactive',
      reason,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await agentService.publicReceiverProfile(result.receiver)},
      'Receiver terminated',
    );
  } catch (error) {
    console.error('[agent.terminateReceiver]', error);
    return fail(res, 'Failed to terminate receiver.', 500);
  }
}

async function activateReceiver(req, res) {
  try {
    const result = await agentService.setReceiverStatus(
      req.auth.agentId,
      req.params.id,
      'active',
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await agentService.publicReceiverProfile(result.receiver)},
      'Receiver activated',
    );
  } catch (error) {
    console.error('[agent.activateReceiver]', error);
    return fail(res, 'Failed to activate receiver.', 500);
  }
}

async function getCredentials(req, res) {
  try {
    const result = await agentService.getCredentials(
      req.auth.agentId,
      req.params.id,
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(res, result.data, 'Credentials fetched');
  } catch (error) {
    console.error('[agent.getCredentials]', error);
    return fail(res, 'Failed to fetch credentials.', 500);
  }
}

async function listCredentials(req, res) {
  try {
    const receivers = await agentService.listCredentialReceivers(
      req.auth.agentId,
    );
    return ok(res, {receivers}, 'Credential receivers fetched');
  } catch (error) {
    console.error('[agent.listCredentials]', error);
    return fail(res, 'Failed to list credentials.', 500);
  }
}

async function submitForReview(req, res) {
  try {
    const result = await agentService.submitForReview(
      req.auth.agentId,
      req.params.id,
      req.body || {},
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await agentService.publicReceiverProfile(result.receiver)},
      'Submitted for review',
    );
  } catch (error) {
    console.error('[agent.submitForReview]', error);
    return fail(res, 'Failed to submit for review.', 500);
  }
}

module.exports = {
  login,
  me,
  updateProfile,
  updatePassword,
  createReceiver,
  listReceivers,
  receiverStats,
  listPending,
  getReceiver,
  approveReceiver,
  rejectReceiver,
  requestChanges,
  terminateReceiver,
  activateReceiver,
  getCredentials,
  listCredentials,
  submitForReview,
};
