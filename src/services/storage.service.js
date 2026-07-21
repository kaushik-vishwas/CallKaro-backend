/**
 * Storage abstraction for file uploads.
 *
 * All S3 settings come from .env — swap bucket/account without code changes.
 *
 * Required:
 *   AWS_S3_BUCKET, AWS_S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * Optional:
 *   AWS_S3_ENDPOINT   — MinIO / Spaces / custom endpoint
 *   AWS_S3_CDN_URL    — CloudFront (or other CDN) base URL
 *   AWS_S3_PUBLIC_READ — "true" if objects are publicly readable (skip signing)
 *   AWS_S3_SIGNED_URL_EXPIRES — seconds for signed GET URLs (default 604800 = 7d)
 */

const path = require('path');
const crypto = require('crypto');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const {getSignedUrl} = require('@aws-sdk/s3-request-presigner');
const {config} = require('../config');

let s3Client = null;

function getS3Client() {
  if (s3Client) return s3Client;

  const clientConfig = {
    region: config.s3Region,
  };

  if (config.s3AccessKeyId && config.s3SecretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.s3AccessKeyId,
      secretAccessKey: config.s3SecretAccessKey,
    };
  }

  if (config.s3Endpoint) {
    clientConfig.endpoint = config.s3Endpoint;
    clientConfig.forcePathStyle = true;
  }

  s3Client = new S3Client(clientConfig);
  return s3Client;
}

function generateKey(folder, originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.jpg';
  const hash = crypto.randomBytes(12).toString('hex');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
  return `${folder}/${date}/${hash}${ext}`;
}

/** Stable (unsigned) object URL — stored in DB, not for browser fetch on private buckets. */
function publicUrl(key) {
  if (config.s3CdnUrl) {
    return `${config.s3CdnUrl.replace(/\/$/, '')}/${key}`;
  }
  if (config.s3Endpoint) {
    return `${config.s3Endpoint.replace(/\/$/, '')}/${config.s3Bucket}/${key}`;
  }
  return `https://${config.s3Bucket}.s3.${config.s3Region}.amazonaws.com/${key}`;
}

/**
 * Extract S3 object key from a key, permanent URL, or signed URL.
 */
function extractKey(urlOrKey) {
  if (!urlOrKey || typeof urlOrKey !== 'string') return null;
  const value = urlOrKey.trim();
  if (!value) return null;

  if (!/^https?:\/\//i.test(value)) {
    return value.replace(/^\//, '');
  }

  try {
    const parsed = new URL(value);
    let key = decodeURIComponent(parsed.pathname.replace(/^\//, ''));

    // Path-style: /bucket/key...
    if (config.s3Bucket && key.startsWith(`${config.s3Bucket}/`)) {
      key = key.slice(config.s3Bucket.length + 1);
    }

    return key || null;
  } catch {
    return null;
  }
}

/** Normalize any uploaded/signed URL into a stable storage URL for MongoDB. */
function toStorageUrl(urlOrKey) {
  const key = extractKey(urlOrKey);
  if (!key) return urlOrKey;
  return publicUrl(key);
}

/**
 * Browser-usable URL. Uses CDN as-is, or public URL if AWS_S3_PUBLIC_READ=true,
 * otherwise a pre-signed GET URL (private buckets).
 */
async function toAccessUrl(urlOrKey, expiresInSeconds = config.s3SignedUrlExpires) {
  if (!urlOrKey) return urlOrKey;

  if (config.s3CdnUrl && String(urlOrKey).startsWith(config.s3CdnUrl)) {
    return urlOrKey;
  }

  const key = extractKey(urlOrKey);
  if (!key) return urlOrKey;

  if (config.s3PublicRead) {
    return publicUrl(key);
  }

  if (!config.s3Bucket) return publicUrl(key);

  return getSignedDownloadUrl(key, expiresInSeconds);
}

async function mapAccessUrls(urls) {
  if (!Array.isArray(urls)) return [];
  return Promise.all(urls.map(url => toAccessUrl(url)));
}

/**
 * Upload a file buffer to S3.
 * Returns a signed `url` safe for immediate <img> display on private buckets.
 */
async function uploadFile({buffer, originalName, mimeType, folder}) {
  if (!config.s3Bucket) {
    throw new Error('AWS_S3_BUCKET is not configured. Set it in .env');
  }

  const key = generateKey(folder, originalName);
  const client = getS3Client();

  const putInput = {
    Bucket: config.s3Bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    CacheControl: 'max-age=31536000',
  };

  // Only works if the bucket allows ACLs (often blocked). Prefer signed URLs.
  if (config.s3PublicRead) {
    putInput.ACL = 'public-read';
  }

  await client.send(new PutObjectCommand(putInput));

  const storageUrl = publicUrl(key);
  const accessUrl = await toAccessUrl(key);

  return {
    key,
    url: accessUrl,
    storageUrl,
    size: buffer.length,
  };
}

async function deleteFile(key) {
  if (!key || !config.s3Bucket) return;
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
    }),
  );
}

async function getSignedDownloadUrl(key, expiresInSeconds = config.s3SignedUrlExpires) {
  const client = getS3Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
    }),
    {expiresIn: expiresInSeconds},
  );
}

function isStorageConfigured() {
  return Boolean(config.s3Bucket && config.s3Region);
}

module.exports = {
  uploadFile,
  deleteFile,
  getSignedDownloadUrl,
  publicUrl,
  extractKey,
  toStorageUrl,
  toAccessUrl,
  mapAccessUrls,
  isStorageConfigured,
};
