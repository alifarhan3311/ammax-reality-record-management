import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import { google } from 'googleapis';
import { Readable } from 'node:stream';
import Transaction from './models/Transaction.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

let connectionPromise;
export const connectDatabase = async () => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured');
  if (!connectionPromise) connectionPromise = mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 }).catch(error => { connectionPromise = undefined; throw error; });
  await connectionPromise;
  return mongoose.connection;
};

app.use('/api', async (_req, res, next) => {
  try { await connectDatabase(); next(); }
  catch (error) { res.status(503).json({ message: 'Database connection failed', error: error.message }); }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
const driveClient = () => {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID } = process.env;
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY || !GOOGLE_DRIVE_FOLDER_ID) throw new Error('Google Drive credentials are not configured');
  const auth = new google.auth.JWT({ email: GOOGLE_SERVICE_ACCOUNT_EMAIL, key: GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), scopes: ['https://www.googleapis.com/auth/drive'] });
  return { drive: google.drive({ version: 'v3', auth }), folderId: GOOGLE_DRIVE_FOLDER_ID };
};

app.get('/api/health', (_req, res) => res.json({ status: 'ok', database: mongoose.connection.name }));
app.get('/api/transactions', async (_req, res) => {
  try { res.json(await Transaction.find().sort({ createdAt: -1 }).lean()); }
  catch (error) { res.status(500).json({ message: 'Could not load transactions', error: error.message }); }
});
app.get('/api/transactions/:id', async (req, res) => {
  try { const record = await Transaction.findById(req.params.id).lean(); if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json(record); }
  catch (error) { const status = error.name === 'CastError' ? 404 : 500; res.status(status).json({ message: status === 404 ? 'Transaction not found' : 'Could not load transaction' }); }
});
app.post('/api/transactions', async (req, res) => {
  const { address, agent, buyer, email } = req.body;
  if (![address, agent, buyer, email].every(value => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Address, agent, buyer and email are required' });
  try { res.status(201).json(await Transaction.create(req.body)); }
  catch (error) { res.status(500).json({ message: 'Could not create transaction', error: error.message }); }
});
app.put('/api/transactions/:id', async (req, res) => {
  try {
    const allowed = ['address', 'agent', 'closeOfDeal', 'salePrice', 'buyer', 'acceptanceDate', 'dealNumber', 'email', 'seller', 'reviewer', 'yearBuilt', 'type', 'checklistType', 'office', 'subjectRemovalDate', 'mlsNumber', 'streetNumber', 'direction', 'streetName', 'unitNumber', 'postalCode', 'province', 'city', 'county', 'coBuyerAgent', 'source', 'officeLead', 'fileId', 'actualClosingDate'];
    const updates = Object.fromEntries(Object.entries(req.body).filter(([key]) => allowed.includes(key)));
    const record = await Transaction.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
    if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json(record);
  } catch (error) { res.status(500).json({ message: 'Could not update transaction', error: error.message }); }
});

for (const section of ['contacts', 'commission', 'checklist']) {
  app.put(`/api/transactions/:id/${section}`, async (req, res) => {
    try {
      const value = section === 'checklist' ? (Array.isArray(req.body.checklist) ? req.body.checklist : []) : (req.body[section] || {});
      const record = await Transaction.findByIdAndUpdate(req.params.id, { $set: { [section]: value } }, { new: true, runValidators: true });
      if (!record) return res.status(404).json({ message: 'Transaction not found' }); res.json(record);
    } catch (error) { res.status(500).json({ message: `Could not save ${section}`, error: error.message }); }
  });
}

app.post('/api/transactions/:id/checklist/:itemId/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Please select a file' });
  try {
    const transaction = await Transaction.findById(req.params.id).lean();
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    const { drive, folderId } = driveClient();
    const safeAddress = (transaction.address || 'Transaction').replace(/[^a-z0-9 _-]/gi, '').slice(0, 60);
    const response = await drive.files.create({ requestBody: { name: `${safeAddress} - ${req.file.originalname}`, parents: [folderId] }, media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) }, fields: 'id,name,webViewLink,webContentLink,mimeType,size' });
    res.status(201).json(response.data);
  } catch (error) { res.status(500).json({ message: 'Google Drive upload failed', error: error.message }); }
});

export default app;
