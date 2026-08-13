const {ok, fail} = require('../utils/response');
const adminCompliance = require('../services/adminCompliance.service');
const chatModeration = require('../services/chatModeration.service');

async function listCases(req, res) {
  try {
    const {
      q,
      status,
      source,
      page,
      limit,
      dateFrom,
      dateTo,
      detectionSource,
    } = req.query || {};
    const result = await adminCompliance.listComplianceCases({
      q,
      status,
      source: source || 'detected',
      page,
      limit,
      dateFrom,
      dateTo,
      detectionSource,
    });
    return ok(res, result, 'Compliance cases fetched');
  } catch (error) {
    console.error('[admin.compliance.list]', error);
    return fail(res, 'Failed to fetch compliance cases.', 500);
  }
}

async function caseStats(req, res) {
  try {
    const source = req.query?.source || 'detected';
    const stats = await adminCompliance.getComplianceStats(source);
    return ok(res, {stats}, 'Compliance stats fetched');
  } catch (error) {
    console.error('[admin.compliance.stats]', error);
    return fail(res, 'Failed to fetch compliance stats.', 500);
  }
}

async function getCase(req, res) {
  try {
    const result = await adminCompliance.getComplianceCase(req.params.id);
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {case: result.case}, 'Case fetched');
  } catch (error) {
    console.error('[admin.compliance.get]', error);
    return fail(res, 'Failed to fetch case.', 500);
  }
}

async function assignCase(req, res) {
  try {
    const {agentId, note} = req.body || {};
    const result = await adminCompliance.assignCase(
      req.params.id,
      agentId,
      note,
      req.auth?.adminId,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(res, {case: result.case}, 'Case assigned');
  } catch (error) {
    console.error('[admin.compliance.assign]', error);
    return fail(res, 'Failed to assign case.', 500);
  }
}

async function dismissCase(req, res) {
  try {
    const result = await adminCompliance.dismissCase(
      req.params.id,
      req.auth?.adminId,
      req.body?.reason,
    );
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {case: result.case}, 'Case dismissed');
  } catch (error) {
    console.error('[admin.compliance.dismiss]', error);
    return fail(res, 'Failed to dismiss case.', 500);
  }
}

async function blockCase(req, res) {
  try {
    const result = await adminCompliance.blockReportedUser(
      req.params.id,
      req.auth?.adminId,
      req.body?.reason,
    );
    if (!result.ok) return fail(res, result.message, 400);
    return ok(res, {case: result.case}, 'User blocked');
  } catch (error) {
    console.error('[admin.compliance.block]', error);
    return fail(res, 'Failed to block user.', 500);
  }
}

// Keep legacy ticket report endpoints working via chatModeration
async function listReports(req, res) {
  try {
    const result = await chatModeration.listReports(req.query || {});
    return ok(res, result, 'Reports fetched');
  } catch (error) {
    console.error('[admin.listReports]', error);
    return fail(res, 'Failed to fetch reports.', 500);
  }
}

module.exports = {
  listCases,
  caseStats,
  getCase,
  assignCase,
  dismissCase,
  blockCase,
  listReports,
};
