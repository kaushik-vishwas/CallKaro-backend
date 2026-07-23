const {ok, fail} = require('../utils/response');
const adminAgentsService = require('../services/adminAgents.service');

async function listAgents(req, res) {
  try {
    const {
      q,
      status,
      tab,
      page,
      limit,
      dateFrom,
      dateTo,
    } = req.query || {};

    const result = await adminAgentsService.listAgents({
      q,
      status,
      tab,
      page,
      limit,
      dateFrom,
      dateTo,
    });

    return ok(res, result, 'Agents fetched');
  } catch (error) {
    console.error('[admin.listAgents]', error);
    return fail(res, 'Failed to fetch agents.', 500);
  }
}

async function agentStats(req, res) {
  try {
    const stats = await adminAgentsService.getAgentStats();
    return ok(res, {stats}, 'Agent stats fetched');
  } catch (error) {
    console.error('[admin.agentStats]', error);
    return fail(res, 'Failed to fetch agent stats.', 500);
  }
}

async function createAgent(req, res) {
  try {
    const {name, email, phone, password, agentCode} = req.body || {};
    const result = await adminAgentsService.createAgent({
      name,
      email,
      phone,
      password,
      agentCode,
    });
    if (!result.ok) return fail(res, result.message, 400);

    return ok(
      res,
      {
        agent: result.agent,
        temporaryPassword: result.temporaryPassword,
      },
      'Agent created',
      201,
    );
  } catch (error) {
    console.error('[admin.createAgent]', error);
    return fail(res, 'Failed to create agent.', 500);
  }
}

async function getAgent(req, res) {
  try {
    const result = await adminAgentsService.getAgentDetail(req.params.id);
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {agent: result.agent}, 'Agent fetched');
  } catch (error) {
    console.error('[admin.getAgent]', error);
    return fail(res, 'Failed to fetch agent.', 500);
  }
}

async function updateAgent(req, res) {
  try {
    const result = await adminAgentsService.updateAgent(
      req.params.id,
      req.body || {},
    );
    if (!result.ok) return fail(res, result.message, result.message === 'Agent not found.' ? 404 : 400);
    return ok(res, {agent: result.agent}, 'Agent updated');
  } catch (error) {
    console.error('[admin.updateAgent]', error);
    return fail(res, 'Failed to update agent.', 500);
  }
}

async function resetAgentPassword(req, res) {
  try {
    const {newPassword} = req.body || {};
    const result = await adminAgentsService.resetAgentPassword(
      req.params.id,
      newPassword,
    );
    if (!result.ok) return fail(res, result.message, 404);
    return ok(
      res,
      {temporaryPassword: result.temporaryPassword},
      'Password reset',
    );
  } catch (error) {
    console.error('[admin.resetAgentPassword]', error);
    return fail(res, 'Failed to reset password.', 500);
  }
}

module.exports = {
  listAgents,
  agentStats,
  createAgent,
  getAgent,
  updateAgent,
  resetAgentPassword,
};
