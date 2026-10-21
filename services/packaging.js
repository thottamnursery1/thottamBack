const SKIP_NOTE = 'Customer skipped the outer carton. Keep the essential protective wrap so the plants stay safe in delivery.';
const CARTON_NOTE = 'Customer asked for a carton box. Pack the plants with essential protection inside the carton.';
const CARTON_FEE = 31;

function packagingFields(needsCartonBox) {
  if (needsCartonBox !== true && needsCartonBox !== false) return null;
  const packagingFee = needsCartonBox ? CARTON_FEE : 0;
  return {
    needsCartonBox,
    essentialPackaging: true,
    packagingNote: needsCartonBox ? CARTON_NOTE : SKIP_NOTE,
    packagingFee,
  };
}

function withPackagingFee(pricing, packaging) {
  const packagingFee = packaging?.needsCartonBox ? CARTON_FEE : 0;
  const totalAmount = Math.max(0, Number(pricing?.totalAmount) || 0) + packagingFee;
  return {
    ...pricing,
    packagingFee,
    totalAmount,
  };
}

module.exports = { packagingFields, withPackagingFee, SKIP_NOTE, CARTON_NOTE, CARTON_FEE };
