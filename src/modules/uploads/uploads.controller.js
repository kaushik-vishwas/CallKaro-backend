const {ok, fail} = require('../../utils/response');
const storageService = require('../../services/storage.service');

async function uploadPhoto(req, res) {
  try {
    if (!req.file) {
      return fail(res, 'No file provided.', 400);
    }

    const result = await storageService.uploadFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      folder: 'receivers/photos',
    });

    return ok(
      res,
      {
        url: result.url,
        key: result.key,
        size: result.size,
      },
      'Photo uploaded',
      201,
    );
  } catch (error) {
    console.error('[uploads.uploadPhoto]', error);
    return fail(res, error.message || 'Failed to upload photo.', 500);
  }
}

async function uploadPhotos(req, res) {
  try {
    if (!req.files?.length) {
      return fail(res, 'No files provided.', 400);
    }

    const results = await Promise.all(
      req.files.map(file =>
        storageService.uploadFile({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder: 'receivers/photos',
        }),
      ),
    );

    return ok(
      res,
      {
        files: results.map(r => ({
          url: r.url,
          key: r.key,
          size: r.size,
        })),
      },
      `${results.length} photo(s) uploaded`,
      201,
    );
  } catch (error) {
    console.error('[uploads.uploadPhotos]', error);
    return fail(res, error.message || 'Failed to upload photos.', 500);
  }
}

async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return fail(res, 'No file provided.', 400);
    }

    const docType = req.body.docType || req.query.docType || 'document';

    const result = await storageService.uploadFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      folder: `receivers/kyc/${docType}`,
    });

    return ok(
      res,
      {
        url: result.url,
        key: result.key,
        size: result.size,
        docType,
      },
      'Document uploaded',
      201,
    );
  } catch (error) {
    console.error('[uploads.uploadDocument]', error);
    return fail(res, error.message || 'Failed to upload document.', 500);
  }
}

async function uploadVideo(req, res) {
  try {
    if (!req.file) {
      return fail(res, 'No file provided.', 400);
    }

    const result = await storageService.uploadFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname || 'verification.webm',
      mimeType: req.file.mimetype,
      folder: 'receivers/kyc/video',
    });

    return ok(
      res,
      {
        url: result.url,
        key: result.key,
        size: result.size,
      },
      'Video uploaded',
      201,
    );
  } catch (error) {
    console.error('[uploads.uploadVideo]', error);
    return fail(res, error.message || 'Failed to upload video.', 500);
  }
}

async function deleteFile(req, res) {
  try {
    const {key} = req.body || {};
    if (!key) {
      return fail(res, 'File key is required.', 400);
    }
    await storageService.deleteFile(key);
    return ok(res, {}, 'File deleted');
  } catch (error) {
    console.error('[uploads.deleteFile]', error);
    return fail(res, 'Failed to delete file.', 500);
  }
}

module.exports = {uploadPhoto, uploadPhotos, uploadDocument, uploadVideo, deleteFile};
