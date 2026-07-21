const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const {registerModuleRoutes} = require('./modules');
const {ok, fail} = require('./utils/response');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({limit: '2mb'}));
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => {
    return ok(res, {service: 'backend', mode: 'local'}, 'OK');
  });

  app.get('/api/health', (_req, res) => {
    return ok(res, {service: 'backend', mode: 'local'}, 'OK');
  });

  registerModuleRoutes(app);

  app.use((_req, res) => fail(res, 'Route not found', 404));

  app.use((err, _req, res, _next) => {
    console.error(err);
    return fail(res, err.message || 'Internal server error', 500);
  });

  return app;
}

module.exports = {createApp};
