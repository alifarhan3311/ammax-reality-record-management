import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import multer from 'multer';
import { google } from 'googleapis';
import { Readable } from 'node:stream';
import { createPrivateKey } from 'node:crypto';
import Transaction from './models/Transaction.js';
import User from './models/User.js';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

let connectionPromise;
export const connectDatabase = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured');
  if (!connectionPromise) connectionPromise = mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
    socketTimeoutMS: 15000,
    maxPoolSize: 5,
    minPoolSize: 0
  }).catch(error => { connectionPromise = undefined; throw error; });
  await connectionPromise;
  return mongoose.connection;
};

const publicUser = user => ({ id: user._id, name: user.name, email: user.email, role: user.role });
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
const ownerFilter = (req, id) => req.user.role === 'admin' ? { _id: id } : { _id: id, createdBy: req.user._id };

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.name }));
app.post('/api/auth/signup', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim(); const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
    if (name.length < 2) return res.status(400).json({ message: 'Please enter your full name' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: 'Please enter a valid email' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must contain at least 8 characters' });
    if (await User.exists({ email })) return res.status(409).json({ message: 'An account with this email already exists' });
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'user' });
    setAuthCookie(res, user); res.status(201).json({ user: publicUser(user) });
  } catch (error) { res.status(500).json({ message: 'Could not create account', error: error.message }); }
});
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user || !user.isActive || !await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid email or password' });
  setAuthCookie(res, user); res.json({ user: publicUser(user) });
});
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('ammax_session', { path: '/' }); res.json({ message: 'Logged out' }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.get('/api/transactions', requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { createdBy: req.user._id };
    res.json(await Transaction.find(filter).populate('createdBy', 'name email role').sort({ createdAt: -1 }).lean());
  } catch (error) { res.status(500).json({ message: 'Could not load transactions', error: error.message }); }
});
app.get('/api/transactions/:id', requireAuth, async (req, res) => {
  try { const record = await Transaction.findOne(ownerFilter(req, req.params.id)).populate('createdBy', 'name email role').lean(); if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json(record); }
  catch (error) { const status = error.name === 'CastError' ? 404 : 500; res.status(status).json({ message: status === 404 ? 'Transaction not found' : 'Could not load transaction' }); }
});
app.post('/api/transactions', requireAuth, async (req, res) => {
  const { address, agent, buyer, email } = req.body;
  if (![address, agent, buyer, email].every(value => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Address, agent, buyer and email are required' });
  try { res.status(201).json(await Transaction.create({ ...req.body, createdBy: req.user._id })); }
  catch (error) { res.status(500).json({ message: 'Could not create transaction', error: error.message }); }
});
app.put('/api/transactions/:id', requireAuth, async (req, res) => {
  try {
    const allowed = ['address', 'agent', 'closeOfDeal', 'salePrice', 'buyer', 'acceptanceDate', 'dealNumber', 'email', 'seller', 'reviewer', 'yearBuilt', 'type', 'checklistType', 'office', 'subjectRemovalDate', 'mlsNumber', 'streetNumber', 'direction', 'streetName', 'unitNumber', 'postalCode', 'province', 'city', 'county', 'coBuyerAgent', 'source', 'officeLead', 'fileId', 'actualClosingDate'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const record = await Transaction.findOneAndUpdate(ownerFilter(req, req.params.id), { $set: updates }, { new: true, runValidators: true });
    if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json(record);
  } catch (error) { res.status(500).json({ message: 'Could not update transaction', error: error.message }); }
});
app.delete('/api/transactions/:id', requireAuth, async (req, res) => {
  try { const record = await Transaction.findOneAndDelete(ownerFilter(req, req.params.id)); if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json({ message: 'Transaction deleted successfully', id: record._id }); }
  catch (error) { const status = error.name === 'CastError' ? 404 : 500; res.status(status).json({ message: status === 404 ? 'Transaction not found' : 'Could not delete transaction' }); }
});

for (const section of ['contacts', 'commission', 'checklist']) {
  app.put(`/api/transactions/:id/${section}`, requireAuth, async (req, res) => {
    try {
      const value = section === 'checklist' ? (Array.isArray(req.body.checklist) ? req.body.checklist : []) : (req.body[section] || {});
      const record = await Transaction.findOneAndUpdate(ownerFilter(req, req.params.id), { $set: { [section]: value } }, { new: true, runValidators: true });
      if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json(record);
    } catch (error) { res.status(500).json({ message: `Could not save ${section}`, error: error.message }); }
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
const driveClient = () => {
  let email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      email ||= credentials.client_email;
      privateKey ||= credentials.private_key;
    } catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  }
  if (!email || !privateKey || !folderId) throw new Error('Google Drive credentials are incomplete');
  privateKey = privateKey.replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  if (!privateKey.startsWith('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) throw new Error('GOOGLE_PRIVATE_KEY must contain the complete private_key from the service-account JSON file');
  try { createPrivateKey(privateKey); }
  catch { throw new Error('GOOGLE_PRIVATE_KEY is invalid or truncated. Copy the complete private_key value from the downloaded Google service-account JSON file'); }
  const auth = new google.auth.JWT({ email, key: privateKey, scopes: ['https://www.googleapis.com/auth/drive'] });
  return { drive: google.drive({ version: 'v3', auth }), folderId };
};
app.post('/api/transactions/:id/checklist/:itemId/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Please select a file' });
  try {
    const transaction = await Transaction.findOne(ownerFilter(req, req.params.id)).lean();
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    const { drive, folderId } = driveClient(); const safeAddress = (transaction.address || 'Transaction').replace(/[^a-z0-9 _-]/gi, '').slice(0, 60);
    const response = await drive.files.create({ requestBody: { name: `${safeAddress} - ${req.file.originalname}`, parents: [folderId] }, media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) }, fields: 'id,name,webViewLink,webContentLink,mimeType,size', supportsAllDrives: true });
    res.status(201).json(response.data);
  } catch (error) { res.status(500).json({ message: 'Google Drive upload failed', error: error.message }); }
});

let bootstrapPromise;
const performAdminBootstrap = async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const password = String(process.env.ADMIN_PASSWORD || '');
  if (!email || !password) return null;
  let admin = await User.findOne({ email });
  if (!admin) admin = await User.create({ name: process.env.ADMIN_NAME || 'AMMAX Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
  else if (admin.role !== 'admin') { admin.role = 'admin'; await admin.save(); }
  await Transaction.updateMany({ createdBy: { $exists: false } }, { $set: { createdBy: admin._id } });
  return admin;
};
export const bootstrapAdmin = async () => {
  if (!bootstrapPromise) bootstrapPromise = performAdminBootstrap().catch(error => { bootstrapPromise = undefined; throw error; });
  return bootstrapPromise;
};

export default app;
