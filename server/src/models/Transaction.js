import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  address: { type: String, required: true, trim: true }, agent: { type: String, required: true, trim: true },
  closeOfDeal: String, salePrice: Number, buyer: { type: String, required: true, trim: true },
  acceptanceDate: String, dealNumber: String, email: { type: String, required: true, trim: true, lowercase: true },
  seller: String, reviewer: { type: String, default: 'Unassigned' }, yearBuilt: String,
  type: { type: String, default: 'Purchase' }, checklistType: { type: String, default: 'Buyer Side Sale' },
  office: String, subjectRemovalDate: String,
  mlsNumber: String, streetNumber: String, direction: String, streetName: String, unitNumber: String,
  postalCode: String, province: String, city: String, county: String, coBuyerAgent: String,
  source: String, officeLead: String, fileId: String, actualClosingDate: String,
  contacts: { type: mongoose.Schema.Types.Mixed, default: {} },
  commission: { type: mongoose.Schema.Types.Mixed, default: {} },
  checklist: { type: mongoose.Schema.Types.Mixed, default: [] }
}, { timestamps: true });

export default mongoose.model('Transaction', transactionSchema);
