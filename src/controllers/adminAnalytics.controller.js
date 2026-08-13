const {ok, fail} = require('../utils/response');
const adminAnalytics = require('../services/adminAnalytics.service');

async function overview(req, res) {
  try {
    const rangeDays = Number(req.query?.rangeDays || req.query?.days || 30);
    const data = await adminAnalytics.getOverview({rangeDays});
    return ok(res, {overview: data}, 'Analytics overview fetched');
  } catch (error) {
    console.error('[admin.analytics.overview]', error);
    return fail(res, 'Failed to fetch analytics overview.', 500);
  }
}

async function packages(req, res) {
  try {
    const rangeDays = Number(req.query?.rangeDays || req.query?.days || 30);
    const data = await adminAnalytics.getPackages({rangeDays});
    return ok(res, data, 'Package analytics fetched');
  } catch (error) {
    console.error('[admin.analytics.packages]', error);
    return fail(res, 'Failed to fetch package analytics.', 500);
  }
}

async function callers(req, res) {
  try {
    const data = await adminAnalytics.getCallerRankings({
      limit: Number(req.query?.limit || 10),
      rangeDays: Number(req.query?.rangeDays || req.query?.days || 30),
    });
    return ok(res, data, 'Caller rankings fetched');
  } catch (error) {
    console.error('[admin.analytics.callers]', error);
    return fail(res, 'Failed to fetch caller rankings.', 500);
  }
}

async function receivers(req, res) {
  try {
    const data = await adminAnalytics.getReceiverRankings({
      period: req.query?.period || 'monthly',
      limit: Number(req.query?.limit || 50),
    });
    return ok(res, data, 'Receiver rankings fetched');
  } catch (error) {
    console.error('[admin.analytics.receivers]', error);
    return fail(res, 'Failed to fetch receiver rankings.', 500);
  }
}

async function agents(req, res) {
  try {
    const data = await adminAnalytics.getAgentRankings({
      period: req.query?.period || 'monthly',
    });
    return ok(res, data, 'Agent rankings fetched');
  } catch (error) {
    console.error('[admin.analytics.agents]', error);
    return fail(res, 'Failed to fetch agent rankings.', 500);
  }
}

async function grossProfit(req, res) {
  try {
    const rangeDays = Number(req.query?.rangeDays || req.query?.days || 30);
    const data = await adminAnalytics.getGrossProfit({rangeDays});
    return ok(res, {grossProfit: data}, 'Gross profit fetched');
  } catch (error) {
    console.error('[admin.analytics.gross]', error);
    return fail(res, 'Failed to fetch gross profit.', 500);
  }
}

async function netProfit(req, res) {
  try {
    const rangeDays = Number(req.query?.rangeDays || req.query?.days || 30);
    const data = await adminAnalytics.getNetProfit({rangeDays});
    return ok(res, {netProfit: data}, 'Net profit fetched');
  } catch (error) {
    console.error('[admin.analytics.net]', error);
    return fail(res, 'Failed to fetch net profit.', 500);
  }
}

module.exports = {
  overview,
  packages,
  callers,
  receivers,
  agents,
  grossProfit,
  netProfit,
};
