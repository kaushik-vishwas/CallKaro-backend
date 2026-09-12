/**
 * Multer middleware configured for memory storage.
 * Files stay in RAM as buffers — never written to disk — then go straight to S3.
 */
const multer = require('multer');
const path = require('path');

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
  'video/3gpp',
  'video/3gpp2',
  'video/mpeg',
  'video/mpg',
  'video/avi',
  'video/x-msvideo',
  'video/x-m4v',
  'video/m4v',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.mov',
  '.m4v',
  '.mkv',
  '.3gp',
  '.3g2',
  '.mpeg',
  '.mpg',
  '.avi',
]);

const MAX_IMAGE_SIZE = Number(process.env.UPLOAD_MAX_IMAGE_MB || 5) * 1024 * 1024;
const MAX_DOC_SIZE = Number(process.env.UPLOAD_MAX_DOC_MB || 10) * 1024 * 1024;
const MAX_VIDEO_SIZE = Number(process.env.UPLOAD_MAX_VIDEO_MB || 64) * 1024 * 1024;

/** Strip codec params: "video/webm;codecs=vp9" → "video/webm" */
function normalizeMime(mime) {
  return String(mime || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
}

function imageFilter(_req, file, cb) {
  const mime = normalizeMime(file.mimetype);
  if (ALLOWED_IMAGE_TYPES.has(mime) || mime.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
  }
}

function docFilter(_req, file, cb) {
  const mime = normalizeMime(file.mimetype);
  if (ALLOWED_DOC_TYPES.has(mime) || mime.startsWith('image/') || mime === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only images and PDF files are allowed.'));
  }
}

function videoFilter(_req, file, cb) {
  const mime = normalizeMime(file.mimetype);
  const ext = path.extname(file.originalname || '').toLowerCase();

  // Exact allow-list (after stripping ;codecs=…)
  if (ALLOWED_VIDEO_TYPES.has(mime)) {
    return cb(null, true);
  }
  // MediaRecorder / phones often send video/* with params or odd subtypes
  if (mime.startsWith('video/')) {
    return cb(null, true);
  }
  // Empty / octet-stream — trust filename extension from recorder or phone gallery
  if (
    (!mime || mime === 'application/octet-stream') &&
    VIDEO_EXTENSIONS.has(ext)
  ) {
    return cb(null, true);
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return cb(null, true);
  }

  cb(
    new Error(
      'Unsupported video format. Please upload MP4, MOV, or WebM from your phone or laptop.',
    ),
  );
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
