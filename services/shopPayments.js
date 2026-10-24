const { maskAccount } = require('./communityCommerce');

const PAYMENT_REQUIRED_MESSAGE = 'Please configure at least one payment method to continue.';
const SELLING_BLOCKED_MESSAGE = 'Configure at least one valid payment method before publishing products.';
const GATEWAY_UNVERIFIED_MESSAGE = 'Payment gateway onboarding is not verified. Add a UPI ID or QR code, or complete gateway onboarding.';

const UPI_RE = /^[a-z0-9][a-z0-9.\-_]{1,255}@[a-z][a-z0-9]{1,63}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const VERIFICATION = ['unverified', 'pending_review', 'verified', 'rejected'];
const MAX_QR_BYTES = 1_500_000;

const blank = () => ({
  upi: { enabled: false, upiId: '', verificationStatus: 'unverified' },
  qr: { enabled: false, imageData: '', fileName: '', mimeType: '', hasImage: false, verificationStatus: 'unverified' },
  gateway: {
    enabled: false,
    provider: 'bank',
    accountHolder: '',
    bankName: '',
    ifsc: '',
    accountLast4: '',
    accountCipher: '',
    onboardingStatus: 'not_started',
    verificationStatus: 'unverified',
    providerReference: '',
  },
});

function sniffImage(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function decodeQrImage(value) {
  const raw = String(value || '').trim();
  const match = /^data:image\/(?:png|jpeg|jpg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
  if (!match) return { error: 'Upload a JPEG, PNG, or WebP QR code image.' };
  let buffer;
  try {
    buffer = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
  } catch {
    return { error: 'Upload a valid QR code image.' };
  }
  if (!buffer.length || buffer.length > MAX_QR_BYTES) return { error: 'QR image must be under 1.5 MB.' };
  const mimeType = sniffImage(buffer);
  if (!mimeType) return { error: 'Upload a valid QR code image.' };
  return {
    mimeType,
    fileName: '',
    imageData: `data:${mimeType};base64,${buffer.toString('base64')}`,
    hasImage: true,
  };
}

function upiCounts(upi = {}) {
  return Boolean(upi.enabled && UPI_RE.test(String(upi.upiId || '')) && upi.verificationStatus !== 'rejected');
}

function qrCounts(qr = {}) {
  const hasImage = Boolean(qr.hasImage || qr.imageData);
  return Boolean(qr.enabled && hasImage && qr.mimeType && qr.verificationStatus !== 'rejected');
}

function gatewayCounts(gateway = {}) {
  return Boolean(
    gateway.enabled
    && (gateway.verificationStatus === 'verified' || gateway.onboardingStatus === 'verified'),
  );
}

function paymentSetupSatisfied(nurseryOrMethods) {
  const methods = nurseryOrMethods?.paymentMethods || nurseryOrMethods || {};
  return upiCounts(methods.upi) || qrCounts(methods.qr) || gatewayCounts(methods.gateway);
}

function publicPaymentMethods(methods = {}) {
  const source = methods || {};
  return {
    upi: {
      enabled: Boolean(source.upi?.enabled),
      upiId: source.upi?.upiId || '',
      verificationStatus: source.upi?.verificationStatus || 'unverified',
    },
    qr: {
      enabled: Boolean(source.qr?.enabled),
      fileName: source.qr?.fileName || '',
      mimeType: source.qr?.mimeType || '',
      hasImage: Boolean(source.qr?.hasImage || source.qr?.imageData),
      imageData: source.qr?.imageData || '',
      verificationStatus: source.qr?.verificationStatus || 'unverified',
    },
    gateway: {
      enabled: Boolean(source.gateway?.enabled),
      provider: source.gateway?.provider || 'bank',
      accountHolder: source.gateway?.accountHolder || '',
      bankName: source.gateway?.bankName || '',
      ifsc: source.gateway?.ifsc || '',
      accountLast4: source.gateway?.accountLast4 || '',
      onboardingStatus: source.gateway?.onboardingStatus || 'not_started',
      verificationStatus: source.gateway?.verificationStatus || 'unverified',
      providerReference: source.gateway?.providerReference || '',
    },
  };
}

function keptStatus(previousStatus, unchanged) {
  if (!unchanged) return 'pending_review';
  if (previousStatus === 'verified' || previousStatus === 'rejected' || previousStatus === 'pending_review') return previousStatus;
  return 'pending_review';
}

function readGatewayFields(input = {}, previous = {}) {
  const accountHolder = String(input.accountHolder || previous.accountHolder || '').trim();
  const bankName = String(input.bankName || previous.bankName || '').trim();
  const ifsc = String(input.ifsc || previous.ifsc || '').trim().toUpperCase();
  const accountNumber = String(input.accountNumber || '').replace(/\s+/g, '');
  if (accountHolder.length < 2) return { error: 'Account holder name is required.' };
  if (bankName.length < 2) return { error: 'Bank name is required.' };
  if (!IFSC_RE.test(ifsc)) return { error: 'Enter a valid IFSC code.' };
  if (!accountNumber) {
    if (!input.keepExistingAccount || !previous.accountCipher || !previous.accountLast4) {
      return { error: 'Enter a valid bank account number.' };
    }
    return {
      accountHolder,
      bankName,
      ifsc,
      accountLast4: previous.accountLast4,
      accountCipher: previous.accountCipher,
      keptAccount: true,
    };
  }
  const masked = maskAccount(accountNumber);
  if (!masked.ok) return { error: masked.message };
  return {
    accountHolder,
    bankName,
    ifsc,
    accountLast4: masked.last4,
    accountCipher: masked.cipher,
    accountNumber,
    keptAccount: false,
  };
}

function buildPaymentMethods(input = {}, previous = {}) {
  const prior = previous || {};
  const next = blank();
  const enabledUpi = Boolean(input.upi?.enabled);
  const enabledQr = Boolean(input.qr?.enabled);
  const enabledGateway = Boolean(input.gateway?.enabled);

  if (!enabledUpi && !enabledQr && !enabledGateway) {
    return { error: PAYMENT_REQUIRED_MESSAGE };
  }

  if (enabledUpi) {
    const upiId = String(input.upi?.upiId || '').trim().toLowerCase();
    if (!UPI_RE.test(upiId)) return { error: 'Enter a valid UPI ID.' };
    const unchanged = upiId === String(prior.upi?.upiId || '').toLowerCase() && prior.upi?.enabled;
    next.upi = {
      enabled: true,
      upiId,
      verificationStatus: keptStatus(prior.upi?.verificationStatus, unchanged),
    };
  }

  if (enabledQr) {
    if (input.qr?.keepExisting && (prior.qr?.imageData || prior.qr?.hasImage)) {
      next.qr = {
        enabled: true,
        imageData: prior.qr.imageData || '',
        fileName: prior.qr.fileName || '',
        mimeType: prior.qr.mimeType || '',
        hasImage: Boolean(prior.qr.hasImage || prior.qr.imageData),
        verificationStatus: keptStatus(prior.qr?.verificationStatus, true),
      };
      if (!next.qr.hasImage || !next.qr.mimeType) return { error: 'Upload a valid QR code image.' };
    } else {
      const image = decodeQrImage(input.qr?.imageData);
      if (image.error) return { error: image.error };
      const unchanged = prior.qr?.imageData && prior.qr.imageData === image.imageData;
      next.qr = {
        enabled: true,
        imageData: image.imageData,
        fileName: String(input.qr?.fileName || prior.qr?.fileName || 'qr-code').slice(0, 120),
        mimeType: image.mimeType,
        hasImage: true,
        verificationStatus: keptStatus(prior.qr?.verificationStatus, unchanged),
      };
    }
  }

  let gatewayPlain = null;
  if (enabledGateway) {
    const fields = readGatewayFields(input.gateway || {}, prior.gateway || {});
    if (fields.error) return { error: fields.error };
    const unchanged = fields.keptAccount
      && fields.ifsc === String(prior.gateway?.ifsc || '')
      && fields.accountHolder === String(prior.gateway?.accountHolder || '')
      && fields.bankName === String(prior.gateway?.bankName || '');
    const previouslyVerified = unchanged && (prior.gateway?.verificationStatus === 'verified' || prior.gateway?.onboardingStatus === 'verified');
    next.gateway = {
      enabled: true,
      provider: previouslyVerified && prior.gateway?.provider === 'razorpay' ? 'razorpay' : 'bank',
      accountHolder: fields.accountHolder,
      bankName: fields.bankName,
      ifsc: fields.ifsc,
      accountLast4: fields.accountLast4,
      accountCipher: fields.accountCipher,
      onboardingStatus: previouslyVerified ? 'verified' : 'pending',
      verificationStatus: previouslyVerified ? 'verified' : 'pending_review',
      providerReference: previouslyVerified ? (prior.gateway?.providerReference || '') : '',
    };
    gatewayPlain = fields.keptAccount ? null : {
      accountHolder: fields.accountHolder,
      bankName: fields.bankName,
      ifsc: fields.ifsc,
      accountNumber: fields.accountNumber,
    };
  }

  return { paymentMethods: next, gatewayPlain };
}

function razorpayConfigured() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  if (!keyId || !secret) return false;
  if (/x{4,}|your_|placeholder/i.test(`${keyId} ${secret}`)) return false;
  return keyId.startsWith('rzp_');
}

async function completeGatewayOnboarding(details) {
  if (!razorpayConfigured()) {
    return { verified: false, onboardingStatus: 'pending', verificationStatus: 'pending_review', provider: 'bank', providerReference: '' };
  }
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const post = async (path, body) => {
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.description || 'Payment gateway onboarding failed.');
      error.statusCode = 400;
      throw error;
    }
    return payload;
  };
  try {
    const contact = await post('/contacts', {
      name: details.accountHolder,
      type: 'vendor',
      reference_id: `shop_${details.ifsc}_${details.accountNumber.slice(-4)}`.slice(0, 40),
    });
    const fund = await post('/fund_accounts', {
      contact_id: contact.id,
      account_type: 'bank_account',
      bank_account: {
        name: details.accountHolder,
        ifsc: details.ifsc,
        account_number: details.accountNumber,
      },
    });
    return {
      verified: true,
      onboardingStatus: 'verified',
      verificationStatus: 'verified',
      provider: 'razorpay',
      providerReference: fund.id || '',
    };
  } catch (error) {
    return {
      verified: false,
      onboardingStatus: 'failed',
      verificationStatus: 'pending_review',
      provider: 'bank',
      providerReference: '',
      message: error.message,
    };
  }
}

async function resolvePaymentMethods(input = {}, previous = {}) {
  const built = buildPaymentMethods(input, previous);
  if (built.error) return built;
  if (built.gatewayPlain) {
    const outcome = await completeGatewayOnboarding(built.gatewayPlain);
    built.paymentMethods.gateway.onboardingStatus = outcome.onboardingStatus;
    built.paymentMethods.gateway.verificationStatus = outcome.verificationStatus;
    built.paymentMethods.gateway.provider = outcome.provider;
    built.paymentMethods.gateway.providerReference = outcome.providerReference || '';
  }
  if (!paymentSetupSatisfied(built.paymentMethods)) {
    const gatewayOnly = built.paymentMethods.gateway.enabled && !built.paymentMethods.upi.enabled && !built.paymentMethods.qr.enabled;
    return { error: gatewayOnly ? GATEWAY_UNVERIFIED_MESSAGE : PAYMENT_REQUIRED_MESSAGE };
  }
  return { paymentMethods: built.paymentMethods };
}

function previewGateway(outcome) {
  return {
    verified: Boolean(outcome.verified),
    onboardingStatus: outcome.onboardingStatus,
    verificationStatus: outcome.verificationStatus,
    provider: outcome.provider,
    message: outcome.verified
      ? 'Payment gateway account verified.'
      : (outcome.message || 'Payment gateway onboarding is not verified yet. This does not count until onboarding succeeds or a super admin verifies the account.'),
  };
}

module.exports = {
  PAYMENT_REQUIRED_MESSAGE,
  SELLING_BLOCKED_MESSAGE,
  GATEWAY_UNVERIFIED_MESSAGE,
  VERIFICATION,
  UPI_RE,
  blank,
  decodeQrImage,
  paymentSetupSatisfied,
  publicPaymentMethods,
  buildPaymentMethods,
  resolvePaymentMethods,
  completeGatewayOnboarding,
  previewGateway,
  readGatewayFields,
};
