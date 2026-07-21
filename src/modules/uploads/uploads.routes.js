const express = require('express');
const {
  uploadImage,
  uploadImages,
  uploadDocument: uploadDocMiddleware,
  uploadVideo: uploadVideoMiddleware,
  handleMulterError,
} = require('../../middleware/upload');
const uploadsController = require('./uploads.controller');

const router = express.Router();

router.post(
  '/photo',
  uploadImage,
  handleMulterError,
  uploadsController.uploadPhoto,
);

router.post(
  '/photos',
  uploadImages,
  handleMulterError,
  uploadsController.uploadPhotos,
);

router.post(
  '/document',
  uploadDocMiddleware,
  handleMulterError,
  uploadsController.uploadDocument,
);

router.post(
  '/video',
  uploadVideoMiddleware,
  handleMulterError,
  uploadsController.uploadVideo,
);

router.post('/delete', uploadsController.deleteFile);

module.exports = router;
