const {ok, fail} = require('../utils/response');
const adminVipService = require('../services/adminVip.service');

async function listVipPlans(req, res) {
  try {
    const [plans, stats] = await Promise.all([
      Promise.resolve(adminVipService.listPlans()),
      adminVipService.getPlanStats(),
    ]);
    return ok(res, {plans, stats}, 'VIP plans fetched');
  } catch (error) {
    console.error('[admin.listVipPlans]', error);
    return fail(res, 'Failed to fetch VIP plans.', 500);
  }
}

async function vipAnalytics(req, res) {
  try {
    const period = String(req.query?.period || 'monthly').toLowerCase();
    const analytics = await adminVipService.getAnalytics(period);
    return ok(res, {analytics}, 'VIP analytics fetched');
  } catch (error) {
    console.error('[admin.vipAnalytics]', error);
    return fail(res, 'Failed to fetch VIP analytics.', 500);
  }
}

async function listVipUsers(req, res) {
  try {
    const {q, tab, page, limit} = req.query || {};
    const result = await adminVipService.listVipUsers({q, tab, page, limit});
    return ok(res, result, 'VIP users fetched');
  } catch (error) {
    console.error('[admin.listVipUsers]', error);
    return fail(res, 'Failed to fetch VIP users.', 500);
  }
}

async function getVipUser(req, res) {
  try {
    const result = await adminVipService.getVipUser(req.params.id);
    if (!result.ok) return fail(res, result.message, 404);
    return ok(res, {user: result.user}, 'VIP user fetched');
  } catch (error) {
    console.error('[admin.getVipUser]', error);
    return fail(res, 'Failed to fetch VIP user.', 500);
  }
}

module.exports = {
  listVipPlans,
  vipAnalytics,
  listVipUsers,
  getVipUser,
};
