const LISTING_STATUSES = ['draft', 'pending', 'published', 'rejected', 'out_of_stock'];

function ownedFilter(nurseryId) {
  return { $or: [{ nursery: nurseryId }, { sellerId: nurseryId }] };
}

function stockListingPatch(product) {
  if (!product) return null;
  if (product.approvalStatus && product.approvalStatus !== 'approved') return null;
  if (product.listingStatus && !['published', 'out_of_stock'].includes(product.listingStatus)) return null;
  const next = Number(product.stock) > 0 ? 'published' : 'out_of_stock';
  if (product.listingStatus === next && product.isActive !== false) return null;
  return { listingStatus: next, isActive: true };
}

module.exports = { LISTING_STATUSES, ownedFilter, stockListingPatch };
