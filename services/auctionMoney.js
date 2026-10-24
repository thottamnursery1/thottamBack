const DONOR_SHARE = 0.8;

function moneyPaise(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function splitWinningBid(amount) {
  const totalPaise = moneyPaise(amount);
  if (totalPaise == null || totalPaise < 100) return null;
  const donorSharePaise = Math.round(totalPaise * DONOR_SHARE);
  const platformSharePaise = totalPaise - donorSharePaise;
  return {
    totalPaise,
    donorSharePaise,
    platformSharePaise,
    totalAmount: totalPaise / 100,
    donorShare: donorSharePaise / 100,
    platformShare: platformSharePaise / 100,
    donorPercent: 80,
    platformPercent: 20,
  };
}

function minimumNextBid(auction) {
  const starting = Number(auction.startingBid) || 0;
  const increment = Number(auction.minIncrement) || 0;
  if (!auction.bidCount) return starting;
  return Math.round((Number(auction.highestBid) + increment) * 100) / 100;
}

function bidIsValid(auction, amount, now = new Date()) {
  const paise = moneyPaise(amount);
  if (!auction || auction.status !== 'live') return 'This auction is not open.';
  if (new Date(auction.endsAt).getTime() <= now.getTime()) return 'This auction has ended.';
  if (paise == null || paise < 100) return 'Enter a bid of at least ₹1.';
  const floor = moneyPaise(minimumNextBid(auction));
  if (paise < floor) return `The next bid must be at least ₹${(floor / 100).toFixed(0)}.`;
  return '';
}

module.exports = { DONOR_SHARE, splitWinningBid, minimumNextBid, bidIsValid, moneyPaise };
