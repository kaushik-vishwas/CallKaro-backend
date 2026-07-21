function ok(res, data = {}, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({
    statusCode,
    success: true,
    message,
    data,
    ...data,
  });
}

function fail(res, message = 'Request failed', statusCode = 400, errors = []) {
  return res.status(statusCode).json({
    statusCode,
    success: false,
    message,
    errors,
  });
}

module.exports = {ok, fail};
