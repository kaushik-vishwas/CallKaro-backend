const {createApp} = require('./app');
const {config} = require('./config');
const {connectMongo} = require('./db/connect');

async function start() {
  await connectMongo();

  const app = createApp();
  app.listen(config.port, config.host, () => {
    console.log('');
    console.log('Callkaro backend running (MongoDB)');
    console.log(`  Local:   http://localhost:${config.port}/api`);
    console.log(`  Health:  http://localhost:${config.port}/api/health`);
    console.log(`  OTP:     ${config.devOtp}`);
    console.log(
      `  S3:      ${config.s3Bucket ? `${config.s3Bucket} (${config.s3Region})` : 'not configured'}`,
    );
    console.log('');
  });
}

start().catch(error => {
  console.error('Failed to start backend:', error.message);
  process.exit(1);
});
