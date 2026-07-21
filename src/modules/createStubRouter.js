const express = require('express');
const {fail} = require('../utils/response');

/**
 * Factory for not-yet-implemented domain routers.
 */
function createStubRouter(moduleName) {
  const router = express.Router();
  router.use((_req, res) =>
    fail(res, `${moduleName} module is not implemented yet`, 501),
  );
  return router;
}

module.exports = {createStubRouter};
