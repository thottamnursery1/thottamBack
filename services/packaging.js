const SKIP_NOTE = 'Customer skipped the outer carton. Keep the essential protective wrap so the plants stay safe in delivery.';
const CARTON_NOTE = 'Customer asked for a carton box. Pack the plants with essential protection inside the carton.';

function packagingFields(needsCartonBox) {
  if (needsCartonBox !== true && needsCartonBox !== false) return null;
  return {
    needsCartonBox,
    essentialPackaging: true,
    packagingNote: needsCartonBox ? CARTON_NOTE : SKIP_NOTE,
  };
}

module.exports = { packagingFields, SKIP_NOTE, CARTON_NOTE };
