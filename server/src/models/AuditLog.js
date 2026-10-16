import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true, index: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ipAddress: String
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

export default mongoose.model('AuditLog', auditLogSchema);
