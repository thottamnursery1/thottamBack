const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

const logAudit = async ({ action, performedBy, targetId, targetModel, details, req }) => {
  try {
    await AuditLog.create({
      action,
      performedBy,
      targetId,
      targetModel,
      details,
      ip: req?.ip,
      userAgent: req?.get('user-agent'),
    });
  } catch (err) {
    logger.error(`Audit log failed: ${err.message}`);
  }
};

module.exports = logAudit;
