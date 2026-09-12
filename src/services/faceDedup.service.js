/**
 * KYC face de-duplication via AWS Rekognition Face Collections.
 * Used only during receiver onboarding video KYC — does not touch calls/chat/wallet.
 */

const {
  RekognitionClient,
  CreateCollectionCommand,
  DescribeCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
} = require('@aws-sdk/client-rekognition');
const {config} = require('../config');
const storageService = require('./storage.service');

let client = null;
let collectionReady = false;

function isConfigured() {
  return Boolean(
    config.rekognitionFaceDedup &&
      config.s3AccessKeyId &&
      config.s3SecretAccessKey &&
      config.rekognitionCollectionId,
  );
}

function getClient() {
  if (client) return client;
  client = new RekognitionClient({
    region: config.rekognitionRegion,
    credentials: {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    },
  });
  return client;
}

async function ensureCollection() {
  if (collectionReady) return;
  const rek = getClient();
  const id = config.rekognitionCollectionId;
  try {
    await rek.send(new DescribeCollectionCommand({CollectionId: id}));
  } catch (error) {
    const name = error?.name || '';
    if (name !== 'ResourceNotFoundException') {
      throw error;
    }
    await rek.send(new CreateCollectionCommand({CollectionId: id}));
    console.log(`[rekognition] created face collection: ${id}`);
  }
  collectionReady = true;
}

function looksLikeImageUrl(url) {
  const key = String(url || '').toLowerCase();
  return /\.(jpe?g|png|webp)(\?|$)/i.test(key) || key.includes('/photos/');
}

/**
 * Pick best still for face match: KYC face frame → videoThumb if image → first photo.
 */
function resolveFaceImageUrl(receiver, payloadKyc = {}) {
  const kyc = {
    ...(receiver.kyc?.toObject?.() || receiver.kyc || {}),
    ...payloadKyc,
  };
  const candidates = [
    kyc.faceImageUrl,
    kyc.videoThumb,
    ...(Array.isArray(receiver.photos) ? receiver.photos : []),
  ].filter(Boolean);

  for (const url of candidates) {
    if (looksLikeImageUrl(url) || String(url).includes('receivers/')) {
      // Prefer explicit face / photo keys over video files
      const lower = String(url).toLowerCase();
      if (lower.includes('.webm') || lower.includes('.mp4') || lower.includes('/video/')) {
        continue;
      }
      return storageService.toStorageUrl(url);
    }
  }
  return null;
}

/**
 * Search + index face for this receiver. Blocks if another receiver already owns the face.
 */
async function assertUniqueKycFace({receiver, imageUrl}) {
  if (!isConfigured()) {
    return {ok: true, skipped: true};
  }

  const faceImage =
    imageUrl ||
    resolveFaceImageUrl(receiver, receiver.kyc?.toObject?.() || receiver.kyc || {});
  if (!faceImage) {
    return {
      ok: false,
      status: 400,
      message:
        'Could not capture a clear face from your verification video. Retake facing the camera.',
    };
  }

  let bytes;
  try {
    bytes = await storageService.getObjectBuffer(faceImage);
  } catch (error) {
    console.error('[rekognition] getObjectBuffer failed:', error.message || error);
    return {
      ok: false,
      status: 400,
      message:
        'Could not read face image for verification. Retake the video and try again.',
    };
  }

  if (!bytes || bytes.length < 100) {
    return {
      ok: false,
      status: 400,
      message: 'Face image is invalid. Retake the verification video.',
    };
  }

  try {
    await ensureCollection();
    const rek = getClient();
    const collectionId = config.rekognitionCollectionId;
    const threshold = Math.min(
      99,
      Math.max(70, Number(config.rekognitionFaceMatchThreshold) || 95),
    );

    const search = await rek.send(
      new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: {Bytes: bytes},
        FaceMatchThreshold: threshold,
        MaxFaces: 5,
        QualityFilter: 'AUTO',
      }),
    );

    const matches = Array.isArray(search.FaceMatches) ? search.FaceMatches : [];
    for (const match of matches) {
      const externalId = String(match.Face?.ExternalImageId || '');
      if (!externalId || externalId === receiver.id) {
        continue;
      }
      return {
        ok: false,
        status: 409,
        message:
          'This face is already registered on Callkaro. Duplicate onboarding is not allowed.',
        matchedReceiverId: externalId,
        similarity: match.Similarity,
      };
    }

    // Re-index: remove previous face for this receiver if present
    if (receiver.faceId) {
      try {
        await rek.send(
          new DeleteFacesCommand({
            CollectionId: collectionId,
            FaceIds: [receiver.faceId],
          }),
        );
      } catch {
        // ignore missing face
      }
    }

    const indexed = await rek.send(
      new IndexFacesCommand({
        CollectionId: collectionId,
        Image: {Bytes: bytes},
        ExternalImageId: String(receiver.id).slice(0, 255),
        MaxFaces: 1,
        QualityFilter: 'AUTO',
        DetectionAttributes: [],
      }),
    );

    const faceRecords = indexed.FaceRecords || [];
    if (!faceRecords.length) {
      return {
        ok: false,
        status: 400,
        message:
          'No clear face detected in the verification video. Face the camera and retake.',
      };
    }

    const faceId = faceRecords[0].Face?.FaceId || '';
    return {
      ok: true,
      faceId,
      faceImageUrl: faceImage,
    };
  } catch (error) {
    const name = error?.name || '';
    const msg = String(error.message || error);
    // InvalidParameterException often = no face in image
    if (
      name === 'InvalidParameterException' ||
      /no face|face could not be detected/i.test(msg)
    ) {
      return {
        ok: false,
        status: 400,
        message:
          'No clear face detected in the verification video. Face the camera and retake.',
      };
    }
    // Missing IAM: rekognition:* on the AWS user used for S3
    if (
      name === 'AccessDeniedException' ||
      /not authorized|AccessDenied|is not authorized to perform: rekognition/i.test(
        msg,
      )
    ) {
      console.error(
        '[rekognition] IAM missing Rekognition permissions on AWS user. Attach policy from backend/scripts/iam-rekognition-face-dedup.json',
      );
      return {
        ok: false,
        status: 503,
        message:
          'Face verification is not set up on the server yet (AWS Rekognition permission missing). Ask admin to enable it, then retry.',
      };
    }
    console.error('[rekognition] assertUniqueKycFace:', msg);
    return {
      ok: false,
      status: 503,
      message:
        'Face verification is temporarily unavailable. Please try again in a moment.',
    };
  }
}

module.exports = {
  isConfigured,
  resolveFaceImageUrl,
  assertUniqueKycFace,
};
