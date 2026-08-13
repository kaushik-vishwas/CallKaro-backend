const {ok, fail} = require('../utils/response');
const adminDashboardService = require('../services/adminDashboard.service');

async function getDashboard(req, res) {
  try {
    const rangeDays = Number(req.query?.rangeDays || req.query?.days || 30);
    const dashboard = await adminDashboardService.getDashboardOverview({
      rangeDays,
    });
    return ok(res, {dashboard}, 'Dashboard fetched');
  } catch (error) {
    console.error('[admin.getDashboard]', error);
    return fail(res, 'Failed to fetch dashboard.', 500);
  }
}

module.exports = {
  getDashboard,
};
