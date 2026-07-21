const {ok, fail} = require('../utils/response');
const receiverService = require('../services/receiver.service');

async function getOnboarding(req, res) {
  try {
    const result = await receiverService.getOnboarding(req.params.token);
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'Onboarding profile fetched',
    );
  } catch (error) {
    console.error('[receiver.getOnboarding]', error);
    return fail(res, 'Failed to load onboarding profile.', 500);
  }
}

async function saveOnboarding(req, res) {
  try {
    const result = await receiverService.saveOnboarding(
      req.params.token,
      req.body || {},
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'Profile saved',
    );
  } catch (error) {
    console.error('[receiver.saveOnboarding]', error);
    return fail(res, 'Failed to save profile.', 500);
  }
}

async function submitOnboarding(req, res) {
  try {
    const result = await receiverService.submitOnboarding(
      req.params.token,
      req.body || {},
    );
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'Profile submitted for review',
    );
  } catch (error) {
    console.error('[receiver.submitOnboarding]', error);
    return fail(res, 'Failed to submit profile.', 500);
  }
}

async function retryOnboarding(req, res) {
  try {
    const result = await receiverService.retryOnboarding(req.params.token);
    if (!result.ok) return fail(res, result.message, result.status || 400);
    return ok(
      res,
      {receiver: await receiverService.publicOnboardingReceiver(result.receiver)},
      'You can update and resubmit your profile',
    );
  } catch (error) {
    console.error('[receiver.retryOnboarding]', error);
    return fail(res, 'Failed to reopen onboarding.', 500);
  }
}

module.exports = {getOnboarding, saveOnboarding, submitOnboarding, retryOnboarding};
