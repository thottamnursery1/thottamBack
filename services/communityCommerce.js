const crypto = require('crypto');

const SETTLEMENT_ACTIONS = {
  accrued: ['eligible', 'reversed'],
  eligible: ['payout_initiated', 'reversed'],
  payout_initiated: ['paid', 'failed'],
  failed: ['payout_initiated', 'reversed'],
  paid: [],
  reversed: [],
};

function canEditListing(actor, listing) {
  if (!actor || !listing) return false;
  if (actor.status !== 'approved') return false;
  return String(actor._id) === String(listing.communitySeller?._id || listing.communitySeller);
}

function canReceiveOrders(seller) {
  return Boolean(seller && seller.status === 'approved');
}

function settlementKey(orderId, sellerId) {
  return `${orderId}:${sellerId}`;
}

function transitionSettlement(current, action) {
  const next = SETTLEMENT_ACTIONS[current] || [];
  if (!next.includes(action)) {
    return { ok: false, message: `Cannot move a ${current || 'unknown'} settlement to ${action}.` };
  }
  return { ok: true, status: action };
}

function confirmPayout({ status, reference }) {
  if (status !== 'payout_initiated') {
    return { ok: false, message: 'A payout can be marked paid only after it has been initiated with the provider.' };
  }
  if (!String(reference || '').trim()) {
    return { ok: false, message: 'A payout provider reference is required before earnings can be marked paid.' };
  }
  return { ok: true, status: 'paid', payoutReference: String(reference).trim() };
}

function allocateRefund({
  productSubtotal = 0,
  commissionAmount = 0,
  deliveryAllocation = 0,
  sellerPayable = 0,
  refundAmount = 0,
  status = 'accrued',
}) {
  const payable = Math.max(0, Number(sellerPayable) || 0);
  const requested = Math.max(0, Number(refundAmount) || 0);
  if (status === 'paid') {
    return {
      sellerPayable: payable,
      sellerReduction: 0,
      commissionReversal: 0,
      deliveryRefund: 0,
      productRefund: 0,
      unapplied: requested,
      exception: true,
      status: 'paid',
    };
  }

  let remaining = requested;
  const productBase = Math.max(0, Number(productSubtotal) || 0);
  const productRefund = Math.min(productBase, remaining);
  remaining -= productRefund;
  const deliveryRefund = Math.min(Math.max(0, Number(deliveryAllocation) || 0), remaining);
  remaining -= deliveryRefund;
  const commissionBase = Math.max(0, Number(commissionAmount) || 0);
  const commissionReversal = productBase > 0
    ? Math.min(commissionBase, Math.round(productRefund * (commissionBase / productBase)))
    : 0;
  const sellerReduction = Math.min(payable, Math.max(0, productRefund - commissionReversal) + deliveryRefund);
  const nextPayable = payable - sellerReduction;
  return {
    sellerPayable: nextPayable,
    sellerReduction,
    commissionReversal,
    deliveryRefund,
    productRefund,
    unapplied: remaining,
    exception: false,
    status: nextPayable === 0 ? 'reversed' : status,
  };
}

function encryptionKey() {
  const secret = process.env.PAYOUT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptSecret(plain) {
  const key = encryptionKey();
  if (!key) {
    const error = new Error('PAYOUT_ENCRYPTION_KEY is not configured.');
    error.statusCode = 503;
    throw error;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload) {
  const key = encryptionKey();
  if (!key || !payload) return '';
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  if (!ivHex || !tagHex || !dataHex) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return plain.toString('utf8');
}

function maskAccount(accountNumber) {
  const digits = String(accountNumber || '').replace(/\s+/g, '');
  if (!/^\d{9,18}$/.test(digits)) {
    return { ok: false, message: 'Enter a valid bank account number.' };
  }
  return { ok: true, last4: digits.slice(-4), cipher: encryptSecret(digits) };
}

function publicPayout(payout = {}) {
  return {
    accountHolder: payout.accountHolder || '',
    bankName: payout.bankName || '',
    ifsc: payout.ifsc || '',
    accountLast4: payout.accountLast4 || '',
    verificationStatus: payout.verificationStatus || 'unverified',
  };
}

function normalizePins(pins) {
  const list = Array.isArray(pins) ? pins : String(pins || '').split(/[\s,]+/);
  return [...new Set(list.map((pin) => String(pin).trim()).filter((pin) => /^\d{6}$/.test(pin)))];
}

function deliveryChoice(product, settings = {}) {
  const options = product.fulfillmentOptions?.length ? product.fulfillmentOptions : ['local_delivery', 'pickup'];
  const method = options.includes('local_delivery')
    ? 'local_delivery'
    : options.includes('pickup')
      ? 'pickup'
      : options[0];
  const configured = Number(product.localDeliveryFee);
  const fallback = Number(settings.communityLocalDeliveryFee);
  const fee = method === 'pickup' ? 0 : (Number.isFinite(configured) && configured >= 0 ? configured : (Number.isFinite(fallback) ? fallback : 40));
  return { method, fee, options };
}

module.exports = {
  canEditListing,
  canReceiveOrders,
  settlementKey,
  transitionSettlement,
  confirmPayout,
  allocateRefund,
  encryptSecret,
  decryptSecret,
  maskAccount,
  publicPayout,
  normalizePins,
  deliveryChoice,
};
