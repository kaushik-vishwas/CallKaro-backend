/**
 * Multer middleware configured for memory storage.
 * Files stay in RAM as buffers — never written to disk — then go straight to S3.
 */
const multer = require('multer');

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const ALLOWED_DOC_TYPES = new Set([
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf',
]);

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
]);

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB

function imageFilter(_req, file, cb) {
  if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
  }
}

function docFilter(_req, file, cb) {
  if (ALLOWED_DOC_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only images and PDF files are allowed.'));
  }
}

function videoFilter(_req, file, cb) {
  if (ALLOWED_VIDEO_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only MP4, WebM, or MOV videos are allowed.'));
  }
}

/**
 * Single image upload (field name = 'file').
 */
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_IMAGE_SIZE},
  fileFilter: imageFilter,
}).single('file');

/**
 * Multiple image uploads (field name = 'files', max 5).
 */
const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_IMAGE_SIZE},
  fileFilter: imageFilter,
}).array('files', 5);

/**
 * Single document upload (field name = 'file').
 */
const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_DOC_SIZE},
  fileFilter: docFilter,
}).single('file');

/**
 * Single video upload (field name = 'file').
 */
const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: MAX_VIDEO_SIZE},
  fileFilter: videoFilter,
}).single('file');

function handleMulterError(err, _req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File is too large.',
        statusCode: 400,
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message,
      statusCode: 400,
    });
  }
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Upload failed.',
      statusCode: 400,
    });
  }
  return next();
}

module.exports = {
  uploadImage,
  uploadImages,
  uploadDocument,
  uploadVideo,
  handleMulterError,
};
