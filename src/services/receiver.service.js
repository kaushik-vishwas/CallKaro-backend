const Receiver = require('../models/Receiver');
const storageService = require('./storage.service');

function genderLabel(gender) {
  if (!gender) return '';
  return gender.charAt(0).toUpperCase() + gender.slice(1);
}

const KYC_TITLES = {
  aadhaar: 'Aadhar Card',
  pan: 'Pan Card',
  passbook: 'Bank Passbook',
};

function plainDoc(doc) {
  if (!doc) return {};
  if (typeof doc.toObject === 'function') return doc.toObject();
  return doc;
}

function normalizePhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return photos.map(url => storageService.toStorageUrl(url)).slice(0, 5);
}

function normalizeDocuments(documents) {
  if (!Array.isArray(documents)) return [];
  return documents
    .map(raw => {
      const doc = plainDoc(raw);
      const id = String(doc.id || '').trim();
      if (!id) return null;
      return {
        id,
        title: String(doc.title || KYC_TITLES[id] || id).trim(),
        sizeLabel: String(doc.sizeLabel || ''),
        url: storageService.toStorageUrl(doc.url || ''),
        thumbnail: storageService.toStorageUrl(doc.thumbnail || doc.url || ''),
      };
    })
    .filter(Boolean);
}

async function publicOnboardingReceiver(receiver) {
  const photos = await storageService.mapAccessUrls(
    Array.isArray(receiver.photos) ? receiver.photos : [],
  );
  const kyc = receiver.kyc || {};
  const bank = receiver.bank || {};
  const rawDocs = Array.isArray(kyc.documents) ? kyc.documents : [];
  const documents = await Promise.all(
    rawDocs.map(async raw => {
      const doc = plainDoc(raw);
      return {
        id: doc.id,
        title: doc.title || KYC_TITLES[doc.id] || doc.id,
        sizeLabel: doc.sizeLabel || '',
        url: await storageService.toAccessUrl(doc.url || ''),
        thumbnail: await storageService.toAccessUrl(doc.thumbnail || doc.url || ''),
      };
    }),
  );
  const videoUrl = await storageService.toAccessUrl(kyc.videoUrl || '');
  const videoThumb = await storageService.toAccessUrl(
    kyc.videoThumb || photos[0] || '',
  );

  return {
    id: receiver.id,
    name: receiver.name,
    age: receiver.age,
    gender: genderLabel(receiver.gender),
    level: receiver.level,
    status: receiver.status,
    rejectionReason: receiver.rejectionReason || '',
    bio: receiver.bio || '',
    languages: receiver.languages || [],
    photos,
    bank: {
      holderName: bank.holderName || receiver.name,
      accountNumber: bank.accountNumber || '',
      ifsc: bank.ifsc || '',
      upiId: bank.upiId || '',
    },
    kyc: {
      videoUrl: videoUrl || '',
      videoThumb: videoThumb || '',
      documents,
    },
  };
}

async function findByOnboardingToken(token) {
  return Receiver.findOne({onboardingToken: token});
}

async function getOnboarding(token) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  return {ok: true, receiver};
}

async function saveOnboarding(token, payload = {}) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  if (!['pending_onboarding', 'draft'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Profile can no longer be edited from this link.',
      status: 400,
    };
  }

  if (typeof payload.bio === 'string') receiver.bio = payload.bio.trim();
  if (Array.isArray(payload.languages)) receiver.languages = payload.languages;
  if (Array.isArray(payload.photos)) receiver.photos = normalizePhotos(payload.photos);
  if (payload.bank) {
    receiver.bank = {
      holderName: payload.bank.holderName || receiver.name,
      accountNumber: payload.bank.accountNumber || '',
      ifsc: payload.bank.ifsc || '',
      upiId: payload.bank.upiId || '',
    };
  }

  const nextKyc = {
    videoUrl: receiver.kyc?.videoUrl || '',
    videoThumb: receiver.kyc?.videoThumb || '',
    documents: normalizeDocuments(receiver.kyc?.documents || []),
  };
  if (Array.isArray(payload.kyc?.documents)) {
    nextKyc.documents = normalizeDocuments(payload.kyc.documents);
  }
  if (payload.kyc?.videoUrl) {
    nextKyc.videoUrl = storageService.toStorageUrl(payload.kyc.videoUrl);
  }
  if (payload.kyc?.videoThumb) {
    nextKyc.videoThumb = storageService.toStorageUrl(payload.kyc.videoThumb);
  } else if (!nextKyc.videoThumb) {
    const photos = Array.isArray(payload.photos)
      ? normalizePhotos(payload.photos)
      : receiver.photos;
    nextKyc.videoThumb = photos[0] || '';
  }
  receiver.kyc = nextKyc;

  if (receiver.status === 'draft') receiver.status = 'pending_onboarding';
  await receiver.save();
  return {ok: true, receiver};
}

function validateSubmission(receiver, payload) {
  const photos = payload.photos ?? receiver.photos ?? [];
  const languages = payload.languages ?? receiver.languages ?? [];
  const bio = (payload.bio ?? receiver.bio ?? '').trim();
  const bank = payload.bank ?? receiver.bank ?? {};
  const docs = Array.isArray(payload.kyc?.documents)
    ? payload.kyc.documents
    : receiver.kyc?.documents ?? [];
  const videoUrl = payload.kyc?.videoUrl || receiver.kyc?.videoUrl || '';

  if (!Array.isArray(photos) || photos.length < 3) {
    return 'Upload at least 3 profile photos.';
  }
  if (bio.length < 20) {
    return 'Bio must be at least 20 characters.';
  }
  if (!languages.length) {
    return 'Select at least one language.';
  }
  if (!bank.holderName?.trim() || !bank.accountNumber?.trim() || !bank.ifsc?.trim()) {
    return 'Complete bank account details.';
  }
  const required = ['aadhaar', 'pan', 'passbook'];
  const uploaded = new Set(
    docs.map(doc => (typeof doc?.toObject === 'function' ? doc.toObject().id : doc.id)),
  );
  if (!required.every(id => uploaded.has(id))) {
    return 'Upload all required KYC documents.';
  }
  if (!String(videoUrl).trim()) {
    return 'Record or upload a verification video.';
  }
  return null;
}

async function submitOnboarding(token, payload = {}) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  if (!['pending_onboarding', 'draft'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Profile already submitted.',
      status: 400,
    };
  }

  const merged = {
    bio: payload.bio ?? receiver.bio,
    languages: payload.languages ?? receiver.languages,
    photos: payload.photos ?? receiver.photos,
    bank: payload.bank ?? receiver.bank,
    kyc: {
      ...(receiver.kyc?.toObject?.() || receiver.kyc || {}),
      ...(payload.kyc || {}),
    },
  };

  const validationError = validateSubmission(receiver, merged);
  if (validationError) {
    return {ok: false, message: validationError, status: 400};
  }

  const photos = normalizePhotos(merged.photos);
  const documents = normalizeDocuments(merged.kyc.documents || []);
  const videoUrl = storageService.toStorageUrl(merged.kyc.videoUrl);
  const videoThumb = storageService.toStorageUrl(
    merged.kyc.videoThumb || photos[0] || '',
  );

  receiver.bio = String(merged.bio).trim();
  receiver.languages = merged.languages;
  receiver.photos = photos;
  receiver.bank = {
    holderName: merged.bank.holderName.trim(),
    accountNumber: merged.bank.accountNumber.trim(),
    ifsc: merged.bank.ifsc.trim().toUpperCase(),
    upiId: merged.bank.upiId?.trim() || '',
  };
  receiver.kyc = {
    videoUrl,
    videoThumb,
    documents,
  };
  receiver.status = 'pending_review';
  receiver.rejectionReason = '';
  receiver.submittedAt = new Date();
  await receiver.save();

  return {ok: true, receiver};
}

async function retryOnboarding(token) {
  const receiver = await findByOnboardingToken(token);
  if (!receiver) {
    return {ok: false, message: 'Onboarding link not found.', status: 404};
  }
  if (!['rejected', 'inactive'].includes(receiver.status)) {
    return {
      ok: false,
      message: 'Only rejected or terminated profiles can be resubmitted.',
      status: 400,
    };
  }

  receiver.status = 'pending_onboarding';
  receiver.rejectionReason = '';
  await receiver.save();
  return {ok: true, receiver};
}

module.exports = {
  publicOnboardingReceiver,
  getOnboarding,
  saveOnboarding,
  submitOnboarding,
  retryOnboarding,
};
