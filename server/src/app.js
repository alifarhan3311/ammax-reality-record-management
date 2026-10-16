import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import { google } from 'googleapis';
import { Readable } from 'node:stream';
import Transaction from './models/Transaction.js';
import User from './models/User.js';
import Counter from './models/Counter.js';
import AuditLog from './models/AuditLog.js';
import { checklistChangesEmail, dailyReminderEmail, sendEmail } from './services/email.js';
import dns from 'node:dns';
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

let connectionPromise;
export const connectDatabase = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured');
  if (!connectionPromise) connectionPromise = mongoose.connect(process.env.MONGO_URI, {
    dbName: 'ammax-records',
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 15000,
    maxPoolSize: 5,
    minPoolSize: 0
  }).catch(error => { connectionPromise = undefined; throw error; });
  await connectionPromise;
  return mongoose.connection;
};

const publicUser = user => ({ id: user._id, name: user.name, email: user.email, role: user.role === 'user' ? 'agent' : user.role, isActive: user.isActive, mustChangePassword: user.mustChangePassword, lastLoginAt: user.lastLoginAt, createdAt: user.createdAt });
const tokenSecret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return process.env.JWT_SECRET;
};
const setAuthCookie = (res, user) => {
  const token = jwt.sign({ sub: user._id.toString(), role: user.role }, tokenSecret(), { expiresIn: '7d' });
  res.cookie('ammax_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
};

app.use('/api', async (_req, res, next) => {
  try { await connectDatabase(); next(); }
  catch (error) { res.status(503).json({ message: 'Database connection failed', error: error.message }); }
});

const requireAuth = async (req, res, next) => {
  try {
    const token = req.cookies.ammax_session;
    if (!token) return res.status(401).json({ message: 'Authentication required' });
    const payload = jwt.verify(token, tokenSecret());
    const user = await User.findById(payload.sub);
    if (!user?.isActive) return res.status(401).json({ message: 'Account is unavailable' });
    req.user = user; next();
  } catch { res.status(401).json({ message: 'Session expired. Please sign in again.' }); }
};
const requireAdmin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ message: 'Administrator access required' });
const agentOwnership = userId => ({ $or: [{ assignedAgent: userId }, { assignedAgent: { $exists: false }, createdBy: userId }] });
const ownerFilter = (req, id) => req.user.role === 'admin' ? { _id: id } : { _id: id, ...agentOwnership(req.user._id) };
const writeAudit = async (req, action, details = {}) => {
  try { await AuditLog.create({ actor: req.user?._id, action, targetUser: details.targetUser, transaction: details.transaction, details: details.data || {}, ipAddress: req.ip }); }
  catch (error) { console.error('Audit log failed:', error.message); }
};
const dealCounterId = 'transaction-deal-number';
const initializeDealNumbers = async () => {
  const existingCounter = await Counter.findById(dealCounterId);
  if (existingCounter) return existingCounter;
  try {
    await Counter.create({ _id: dealCounterId, seq: 0 });
    const transactions = await Transaction.find({}).sort({ createdAt: 1, _id: 1 }).select('_id');
    if (transactions.length) {
      await Transaction.bulkWrite(transactions.map((transaction, index) => ({
        updateOne: { filter: { _id: transaction._id }, update: { $set: { dealNumber: String(index + 1) } } }
      })));
    }
    return Counter.findByIdAndUpdate(dealCounterId, { $set: { seq: transactions.length } }, { new: true });
  } catch (error) {
    if (error.code === 11000) return Counter.findById(dealCounterId);
    throw error;
  }
};
const nextDealNumber = async () => {
  await initializeDealNumbers();
  const counter = await Counter.findByIdAndUpdate(dealCounterId, { $inc: { seq: 1 } }, { new: true });
  return String(counter.seq);
};

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.name, authConfigured: Boolean(process.env.JWT_SECRET) }));
app.post('/api/auth/signup', async (req, res) => {
  res.status(403).json({ message: 'Public signup is disabled. Contact an administrator.' });
});
app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
    const user = await User.findOne({ email }).select('+passwordHash');
    if (!user || !user.isActive || !await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid email or password' });
    user.lastLoginAt = new Date(); await user.save();
    setAuthCookie(res, user); await writeAudit({ user, ip: req.ip }, 'auth.login'); res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Login failed:', error.message);
    res.status(500).json({ message: error.message === 'JWT_SECRET is not configured' ? 'Login service is not configured. Add JWT_SECRET in Vercel.' : 'Login service failed', error: error.message });
  }
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('ammax_session', { path: '/' }); res.json({ message: 'Logged out' }); });
app.get('/api/auth/me', async (req, res) => {
  try {
    const token = req.cookies.ammax_session;
    if (!token) return res.json({ user: null });
    const payload = jwt.verify(token, tokenSecret());
    const user = await User.findById(payload.sub);
    if (!user?.isActive) { res.clearCookie('ammax_session', { path: '/' }); return res.json({ user: null }); }
    res.json({ user: publicUser(user) });
  } catch {
    res.clearCookie('ammax_session', { path: '/' });
    res.json({ user: null });
  }
});
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8) return res.status(400).json({ message: 'New password must contain at least 8 characters' });
    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user || !await bcrypt.compare(currentPassword, user.passwordHash)) return res.status(400).json({ message: 'Current password is incorrect' });
    if (await bcrypt.compare(newPassword, user.passwordHash)) return res.status(400).json({ message: 'New password must be different from the temporary password' });
    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();
    await writeAudit(req, 'auth.password_changed');
    res.json({ message: 'Password changed successfully', user: publicUser(user) });
  } catch (error) { res.status(500).json({ message: 'Could not change password', error: error.message }); }
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (_req, res) => {
  try { res.json((await User.find({ role: { $ne: 'admin' } }).sort({ createdAt: -1 })).map(publicUser)); }
  catch (error) { res.status(500).json({ message: 'Could not load agents', error: error.message }); }
});
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim(); const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return res.status(400).json({ message: 'Valid name, email and an 8-character password are required' });
    if (await User.exists({ email })) return res.status(409).json({ message: 'This email is already registered' });
    const agent = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'agent', isActive: true, mustChangePassword: true, createdBy: req.user._id });
    await writeAudit(req, 'agent.created', { targetUser: agent._id, data: { name, email } });
    res.status(201).json(publicUser(agent));
  } catch (error) { res.status(500).json({ message: 'Could not create agent', error: error.message }); }
});
app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const agent = await User.findOneAndUpdate({ _id: req.params.id, role: { $ne: 'admin' } }, { $set: { isActive: Boolean(req.body.isActive) } }, { new: true });
    if (!agent) return res.status(404).json({ message: 'Agent not found' });
    await writeAudit(req, agent.isActive ? 'agent.activated' : 'agent.deactivated', { targetUser: agent._id }); res.json(publicUser(agent));
  } catch (error) { res.status(500).json({ message: 'Could not update account', error: error.message }); }
});
app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  try {
    const password = String(req.body.password || '');
    if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters' });
    const agent = await User.findOne({ _id: req.params.id, role: { $ne: 'admin' } }).select('+passwordHash');
    if (!agent) return res.status(404).json({ message: 'Agent not found' });
    agent.passwordHash = await bcrypt.hash(password, 12); agent.mustChangePassword = true; agent.passwordChangedAt = new Date(); await agent.save();
    await writeAudit(req, 'agent.password_reset', { targetUser: agent._id }); res.json({ message: 'Password reset successfully' });
  } catch (error) { res.status(500).json({ message: 'Could not reset password', error: error.message }); }
});
app.get('/api/admin/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.date) { const start = new Date(`${req.query.date}T00:00:00+05:00`); const end = new Date(start); end.setDate(end.getDate() + 1); filter.createdAt = { $gte: start, $lt: end }; }
    const logs = await AuditLog.find(filter).populate('actor targetUser', 'name email role').populate('transaction', 'address dealNumber').sort({ createdAt: -1 }).limit(500).lean();
    res.json(logs);
  } catch (error) { res.status(500).json({ message: 'Could not load activity logs', error: error.message }); }
});

app.get('/api/transactions', requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : agentOwnership(req.user._id);
    res.json(await Transaction.find(filter).populate('createdBy assignedAgent', 'name email role').sort({ createdAt: -1 }).lean());
  } catch (error) { res.status(500).json({ message: 'Could not load transactions', error: error.message }); }
});
app.get('/api/transactions-export/excel', requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : agentOwnership(req.user._id);
    const records = await Transaction.find(filter).populate('createdBy', 'name email').sort({ createdAt: 1 }).lean();
    const columns = [
      ['Deal Number', 'dealNumber'], ['Address', 'address'], ['Agent', 'agent'], ['Co Agent', 'coBuyerAgent'],
      ['Buyer', 'buyer'], ['Seller', 'seller'], ['Sale Price', 'salePrice'], ['Type', 'type'],
      ['Acceptance Date', 'acceptanceDate'], ['Close of Deal', 'closeOfDeal'], ['Subject Removal Date', 'subjectRemovalDate'],
      ['Email', 'email'], ['Office', 'office'], ['Checklist Type', 'checklistType'],
      ['MLS Number', 'mlsNumber'], ['City', 'city'], ['Province', 'province'],
      ['Created By', record => record.createdBy?.name || ''], ['Created By Email', record => record.createdBy?.email || ''],
      ['Created At', record => record.createdAt ? new Date(record.createdAt).toISOString() : '']
    ];
    const escapeXml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const cell = value => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
    const headerRow = `<Row>${columns.map(([label]) => cell(label)).join('')}</Row>`;
    const dataRows = records.map(record => `<Row>${columns.map(([, accessor]) => cell(typeof accessor === 'function' ? accessor(record) : record[accessor])).join('')}</Row>`).join('');
    const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Transactions"><Table>${headerRow}${dataRows}</Table></Worksheet></Workbook>`;
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ammax-transactions-${date}.xls"`);
    res.setHeader('Content-Length', Buffer.byteLength(workbook, 'utf8'));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(workbook);
  } catch (error) { res.status(500).json({ message: 'Could not export transactions', error: error.message }); }
});
app.get('/api/contacts/search', requireAuth, async (req, res) => {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();
    if (query.length < 2) return res.json([]);
    const filter = req.user.role === 'admin' ? {} : agentOwnership(req.user._id);
    const transactions = await Transaction.find(filter).select('address contacts createdBy').lean();
    const seen = new Set(); const results = [];
    for (const transaction of transactions) {
      for (const [category, storedContacts] of Object.entries(transaction.contacts || {})) {
        const categoryContacts = Array.isArray(storedContacts) ? storedContacts : [storedContacts];
        for (const [contactIndex, contact] of categoryContacts.entries()) {
        if (!contact || typeof contact !== 'object') continue;
        const searchable = [contact.firstName, contact.lastName, contact.companyName, contact.email, contact.phone, contact.city].filter(Boolean).join(' ').toLowerCase();
        if (!searchable.includes(query)) continue;
        const signature = [contact.email?.toLowerCase(), contact.phone, contact.firstName?.toLowerCase(), contact.lastName?.toLowerCase()].filter(Boolean).join('|');
        if (signature && seen.has(signature)) continue;
        if (signature) seen.add(signature);
        results.push({ id: `${transaction._id}:${category}:${contactIndex}`, category, transactionAddress: transaction.address, contact });
        if (results.length === 15) break;
        }
        if (results.length === 15) break;
      }
      if (results.length === 15) break;
    }
    res.json(results);
  } catch (error) { res.status(500).json({ message: 'Could not search contacts', error: error.message }); }
});
app.get('/api/transactions/:id', requireAuth, async (req, res) => {
  try { const record = await Transaction.findOne(ownerFilter(req, req.params.id)).populate('createdBy assignedAgent', 'name email role').lean(); if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json(record); }
  catch (error) { const status = error.name === 'CastError' ? 404 : 500; res.status(status).json({ message: status === 404 ? 'Transaction not found' : 'Could not load transaction' }); }
});
app.post('/api/transactions', requireAuth, async (req, res) => {
  const { address, agent, buyer, email } = req.body;
  if (![address, agent, buyer, email].every(value => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Address, agent, buyer and email are required' });
  try {
    let assignedAgent = req.user._id;
    if (req.user.role === 'admin' && !req.body.assignedAgent) return res.status(400).json({ message: 'Please select an agent for this transaction' });
    if (req.user.role === 'admin' && req.body.assignedAgent) {
      const agent = await User.findOne({ _id: req.body.assignedAgent, role: { $in: ['agent', 'user'] }, isActive: true });
      if (!agent) return res.status(400).json({ message: 'Please select an active agent' });
      assignedAgent = agent._id;
    }
    const record = await Transaction.create({ ...req.body, dealNumber: await nextDealNumber(), createdBy: req.user._id, assignedAgent });
    await writeAudit(req, 'transaction.created', { transaction: record._id, targetUser: assignedAgent, data: { address: record.address, dealNumber: record.dealNumber } });
    res.status(201).json(record);
  }
  catch (error) { res.status(500).json({ message: 'Could not create transaction', error: error.message }); }
});
app.put('/api/transactions/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['address', 'agent', 'closeOfDeal', 'salePrice', 'buyer', 'acceptanceDate', 'email', 'seller', 'reviewer', 'type', 'checklistType', 'office', 'subjectRemovalDate', 'mlsNumber', 'streetNumber', 'direction', 'streetName', 'unitNumber', 'postalCode', 'province', 'city', 'county', 'coBuyerAgent', 'officeLead', 'actualClosingDate'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const record = await Transaction.findOneAndUpdate(ownerFilter(req, req.params.id), { $set: updates }, { new: true, runValidators: true });
    if (!record) return res.status(404).json({ message: 'Transaction not found' }); await writeAudit(req, 'transaction.updated', { transaction: record._id }); res.json(record);
  } catch (error) { res.status(500).json({ message: 'Could not update transaction', error: error.message }); }
});
app.delete('/api/transactions/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only administrators can delete transactions' });
  try {
    const record = await Transaction.findOne(ownerFilter(req, req.params.id));
    if (!record) return res.status(404).json({ message: 'Transaction not found' });
    const driveFileIds = [...new Set((record.checklist || []).flatMap(item => [item?.driveFileId, ...(item?.documents || []).map(document => document?.driveFileId)].filter(Boolean)))];
    const driveWarnings = [];
    if (driveFileIds.length) {
      try {
        const { drive } = driveClient();
        for (const fileId of driveFileIds) {
          try { await drive.files.delete({ fileId, supportsAllDrives: true }); }
          catch (error) { if (error.code !== 404) driveWarnings.push(`${fileId}: ${error.message}`); }
        }
      } catch (error) { driveWarnings.push(error.message); }
    }
    await record.deleteOne();
    await writeAudit(req, 'transaction.deleted', { data: { address: record.address, dealNumber: record.dealNumber } });
    res.json({ message: 'Transaction deleted successfully', id: record._id, deletedDriveFiles: driveFileIds.length - driveWarnings.length, driveWarnings });
  }
  catch (error) { const status = error.name === 'CastError' ? 404 : 500; res.status(status).json({ message: status === 404 ? 'Transaction not found' : 'Could not delete transaction' }); }
});

for (const section of ['contacts', 'commission', 'receipts', 'invoices']) {
  app.put(`/api/transactions/:id/${section}`, requireAuth, async (req, res) => {
    try {
      const isArraySection = ['receipts', 'invoices'].includes(section);
      let value = isArraySection ? (Array.isArray(req.body[section]) ? req.body[section] : []) : (req.body[section] || {});
      if (section === 'commission' && req.user.role !== 'admin') {
        const existing = await Transaction.findOne(ownerFilter(req, req.params.id)).select('commission').lean();
        if (!existing) return res.status(404).json({ message: 'Transaction not found' });
        const allowed = ['salePrice', 'personalDeal', 'listingCommissionPercent', 'listingCommissionAmount', 'saleCommissionPercent', 'saleCommissionAmount', 'officeGrossCommission', 'adminBrokerageComp', 'otherDeductions', 'holdTrustMoney', 'depositAmount', 'chequeDate', 'logBookDate'];
        value = { ...(existing.commission || {}), ...Object.fromEntries(Object.entries(value).filter(([key]) => allowed.includes(key))) };
      }
      const record = await Transaction.findOneAndUpdate(ownerFilter(req, req.params.id), { $set: { [section]: value } }, { new: true, runValidators: true });
      if (!record) return res.status(404).json({ message: 'Transaction not found' }); await writeAudit(req, `${section}.updated`, { transaction: record._id }); res.json(record);
    } catch (error) { res.status(500).json({ message: `Could not save ${section}`, error: error.message }); }
  });
}

app.put('/api/transactions/:id/checklist', requireAuth, async (req, res) => {
  try {
    const checklist = Array.isArray(req.body.checklist) ? req.body.checklist : [];
    const record = await Transaction.findOne(ownerFilter(req, req.params.id)).populate('assignedAgent createdBy', 'name email role');
    if (!record) return res.status(404).json({ message: 'Transaction not found' });
    const previous = new Map((record.checklist || []).map(item => [String(item.id), item]));
    const changes = checklist.map(item => ({ documentation: item.documentation, from: previous.get(String(item.id))?.status || 'Not set', to: item.status })).filter(change => change.from !== change.to);
    record.checklist = checklist; record.markModified('checklist'); await record.save();
    await writeAudit(req, 'checklist.updated', { transaction: record._id, targetUser: record.assignedAgent?._id || record.createdBy?._id, data: { changes } });
    if (req.user.role === 'admin' && changes.length) {
      const agent = record.assignedAgent || record.createdBy;
      if (agent?.email) {
        try {
          const email = checklistChangesEmail({ agentName: agent.name, transaction: record, changes });
          const sent = await sendEmail({ to: agent.email, ...email });
          await writeAudit(req, sent.skipped ? 'email.skipped' : 'email.sent', { transaction: record._id, targetUser: agent._id, data: { type: 'checklist-change', reason: sent.reason } });
        } catch (error) { await writeAudit(req, 'email.failed', { transaction: record._id, targetUser: agent._id, data: { type: 'checklist-change', error: error.message } }); }
      }
    }
    res.json(record);
  } catch (error) { res.status(500).json({ message: 'Could not save checklist', error: error.message }); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024 } });
const driveClient = () => {
  const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN?.trim();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!oauthClientId || !oauthClientSecret || !oauthRefreshToken || !folderId) throw new Error('Google Drive OAuth credentials are incomplete');
  const auth = new google.auth.OAuth2(oauthClientId, oauthClientSecret);
  auth.setCredentials({ refresh_token: oauthRefreshToken });
  return { drive: google.drive({ version: 'v3', auth }), folderId, mode: 'oauth' };
};
app.post('/api/transactions/:id/checklist/:itemId/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Please select a file' });
  try {
    const transaction = await Transaction.findOne(ownerFilter(req, req.params.id)).lean();
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    const { drive, folderId } = driveClient(); const safeAddress = (transaction.address || 'Transaction').replace(/[^a-z0-9 _-]/gi, '').slice(0, 60);
    const response = await drive.files.create({ requestBody: { name: `${safeAddress} - ${req.file.originalname}`, parents: [folderId] }, media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) }, fields: 'id,name,webViewLink,webContentLink,mimeType,size,createdTime', supportsAllDrives: true });
    res.status(201).json(response.data);
  } catch (error) {
    const quotaError = /service accounts do not have storage quota/i.test(error.message);
    res.status(500).json({ message: quotaError ? 'This Google Drive folder requires OAuth user credentials or a Workspace Shared Drive.' : 'Google Drive upload failed', error: error.message });
  }
});

app.get('/api/transactions/:id/checklist/:itemId/document', requireAuth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne(ownerFilter(req, req.params.id)).lean();
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    const item = (transaction.checklist || []).find(row => String(row?.id) === String(req.params.itemId));
    if (!item?.driveFileId) return res.status(404).json({ message: 'Document not found' });

    const { drive } = driveClient();
    const metadata = await drive.files.get({ fileId: item.driveFileId, fields: 'id,name,mimeType,size', supportsAllDrives: true });
    const fileResponse = await drive.files.get(
      { fileId: item.driveFileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream', headers: req.headers.range ? { Range: req.headers.range } : undefined }
    );
    const safeName = String(metadata.data.name || item.attachment || 'document').replace(/[\r\n"\\]/g, '_');
    res.status(fileResponse.status || 200);
    res.setHeader('Content-Type', metadata.data.mimeType || fileResponse.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const header of ['content-length', 'content-range', 'accept-ranges']) {
      if (fileResponse.headers[header]) res.setHeader(header, fileResponse.headers[header]);
    }
    fileResponse.data.on('error', error => {
      console.error('Google Drive stream failed:', error.message);
      if (!res.headersSent) res.status(502).json({ message: 'Could not open document' });
      else res.destroy(error);
    });
    fileResponse.data.pipe(res);
  } catch (error) {
    const status = error.code === 404 ? 404 : error.code === 403 ? 403 : 500;
    if (!res.headersSent) res.status(status).json({
      message: status === 404 ? 'Document no longer exists in Google Drive' : status === 403 ? 'Google Drive access was denied' : 'Could not open document',
      error: error.message
    });
  }
});

app.get('/api/transactions/:id/checklist/:itemId/document/:fileId', requireAuth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne(ownerFilter(req, req.params.id)).lean();
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    const item = (transaction.checklist || []).find(row => String(row?.id) === String(req.params.itemId));
    const allowedFileIds = [item?.driveFileId, ...(item?.documents || []).map(document => document?.driveFileId)].filter(Boolean).map(String);
    if (!allowedFileIds.includes(String(req.params.fileId))) return res.status(404).json({ message: 'Document not found' });

    const { drive } = driveClient();
    const metadata = await drive.files.get({ fileId: req.params.fileId, fields: 'id,name,mimeType,size', supportsAllDrives: true });
    const fileResponse = await drive.files.get(
      { fileId: req.params.fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream', headers: req.headers.range ? { Range: req.headers.range } : undefined }
    );
    const safeName = String(metadata.data.name || 'document').replace(/[\r\n"\\]/g, '_');
    res.status(fileResponse.status || 200);
    res.setHeader('Content-Type', metadata.data.mimeType || fileResponse.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const header of ['content-length', 'content-range', 'accept-ranges']) if (fileResponse.headers[header]) res.setHeader(header, fileResponse.headers[header]);
    fileResponse.data.on('error', error => res.destroy(error));
    fileResponse.data.pipe(res);
  } catch (error) {
    const status = error.code === 404 ? 404 : error.code === 403 ? 403 : 500;
    if (!res.headersSent) res.status(status).json({ message: status === 404 ? 'Document no longer exists in Google Drive' : 'Could not open document', error: error.message });
  }
});

app.delete('/api/transactions/:id/checklist/:itemId/document/:fileId', requireAuth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Only administrators can remove attachments' });
  try {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    const item = (transaction.checklist || []).find(row => String(row?.id) === String(req.params.itemId));
    if (!item) return res.status(404).json({ message: 'Checklist item not found' });
    const documents = item.documents?.length ? item.documents : item.driveFileId ? [{ name: item.attachment, driveFileId: item.driveFileId, mimeType: item.mimeType, uploadedAt: transaction.updatedAt }] : [];
    if (!documents.some(document => String(document.driveFileId) === String(req.params.fileId))) return res.status(404).json({ message: 'Document not found' });
    const { drive } = driveClient();
    try { await drive.files.delete({ fileId: req.params.fileId, supportsAllDrives: true }); }
    catch (error) { if (error.code !== 404) throw error; }
    const remaining = documents.filter(document => String(document.driveFileId) !== String(req.params.fileId));
    const latest = remaining[0];
    item.documents = remaining;
    item.attachment = latest?.name || '';
    item.driveFileId = latest?.driveFileId || '';
    item.mimeType = latest?.mimeType || '';
    item.driveUrl = '';
    transaction.markModified('checklist');
    await transaction.save();
    res.json(transaction);
  } catch (error) { res.status(500).json({ message: 'Could not remove attachment', error: error.message }); }
});

app.get(['/api/cron/checklist-reminders', '/api/cron/checklist-reminders/edt', '/api/cron/checklist-reminders/est'], async (req, res) => {
  if (!process.env.CRON_SECRET || req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ message: 'Invalid cron authorization' });
  try {
    const torontoParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const torontoDate = `${torontoParts.year}-${torontoParts.month}-${torontoParts.day}`;
    if (torontoParts.hour !== '00') return res.json({ skipped: true, reason: 'Not midnight in Toronto', torontoDate });
    const transactions = await Transaction.find({ 'checklist.status': { $in: ['Required', 'Incomplete'] } }).populate('assignedAgent createdBy', 'name email isActive role').lean();
    const grouped = new Map();
    for (const transaction of transactions) {
      const agent = transaction.assignedAgent || transaction.createdBy;
      if (!agent?.email || !agent.isActive || agent.role === 'admin') continue;
      const pending = (transaction.checklist || []).filter(item => ['Required', 'Incomplete'].includes(item.status));
      const group = grouped.get(String(agent._id)) || { agent, items: [] };
      group.items.push(...pending.map(item => ({ transactionId: transaction._id, address: transaction.address, documentation: item.documentation, status: item.status })));
      grouped.set(String(agent._id), group);
    }
    const results = [];
    for (const { agent, items } of grouped.values()) {
      try {
        const alreadySent = await AuditLog.exists({ action: 'email.sent', targetUser: agent._id, 'details.type': 'daily-checklist-reminder', 'details.localDate': torontoDate });
        if (alreadySent) { results.push({ agent: agent.email, sent: false, skipped: true, reason: 'Already sent today', count: items.length }); continue; }
        const email = dailyReminderEmail({ agentName: agent.name, items });
        const sent = await sendEmail({ to: agent.email, ...email });
        await AuditLog.create({ action: sent.skipped ? 'email.skipped' : 'email.sent', targetUser: agent._id, details: { type: 'daily-checklist-reminder', localDate: torontoDate, timezone: 'America/Toronto', count: items.length, reason: sent.reason } });
        results.push({ agent: agent.email, sent: !sent.skipped, count: items.length });
      } catch (error) {
        await AuditLog.create({ action: 'email.failed', targetUser: agent._id, details: { type: 'daily-checklist-reminder', error: error.message } });
        results.push({ agent: agent.email, sent: false, error: error.message });
      }
    }
    res.json({ processedAgents: results.length, results });
  } catch (error) { res.status(500).json({ message: 'Could not send daily reminders', error: error.message }); }
});

app.use((error, _req, res, _next) => {
  console.error('API request failed:', error.message);
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ message: 'Request body is not valid JSON' });
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'File must be 3 MB or smaller' });
  res.status(500).json({ message: 'Unexpected server error', error: error.message });
});

let bootstrapPromise;
const performAdminBootstrap = async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const password = String(process.env.ADMIN_PASSWORD || '');
  await initializeDealNumbers();
  await User.updateMany({ role: 'user' }, { $set: { role: 'agent' } });
  const legacyTransactions = await Transaction.find({ assignedAgent: { $exists: false }, createdBy: { $exists: true } }).select('_id createdBy');
  if (legacyTransactions.length) await Transaction.bulkWrite(legacyTransactions.map(record => ({ updateOne: { filter: { _id: record._id }, update: { $set: { assignedAgent: record.createdBy } } } })));
  if (!email || !password) return null;
  let admin = await User.findOne({ email });
  if (!admin) admin = await User.create({ name: process.env.ADMIN_NAME || 'AMMAX Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
  else if (admin.role !== 'admin') { admin.role = 'admin'; await admin.save(); }
  await Transaction.updateMany({ createdBy: { $exists: false } }, { $set: { createdBy: admin._id } });
  await Transaction.updateMany({ assignedAgent: { $exists: false } }, { $set: { assignedAgent: admin._id } });
  return admin;
};
export const bootstrapAdmin = async () => {
  if (!bootstrapPromise) bootstrapPromise = performAdminBootstrap().catch(error => { bootstrapPromise = undefined; throw error; });
  return bootstrapPromise;
};

export default app;
