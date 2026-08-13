const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const {registerModuleRoutes} = require('./modules');
const {ok, fail} = require('./utils/response');
const streamVideo = require('./services/streamVideo.service');

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    }),
  );
  app.use(express.json({limit: '2mb'}));
  app.use(morgan('dev'));

  const healthPayload = () => {
    const videoProvider = streamVideo.resolveVideoProvider();
    return {
      service: 'backend',
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'local',
      videoProvider,
      streamConfigured: streamVideo.hasStreamCredentials(),
    };
  };

  app.get('/health', (_req, res) => {
    return ok(res, healthPayload(), 'OK');
  });

  app.get('/api/health', (_req, res) => {
    return ok(res, healthPayload(), 'OK');
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
