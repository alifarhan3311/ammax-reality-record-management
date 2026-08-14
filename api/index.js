import app, { bootstrapAdmin, connectDatabase } from '../server/src/app.js';

export default async function handler(req, res) {
  try {
    await connectDatabase();
    await bootstrapAdmin();
    return app(req, res);
  } catch (error) {
    console.error('Serverless initialization failed:', error.message);
    return res.status(503).json({ message: 'Service initialization failed. Check MongoDB Atlas and Vercel environment variables.', error: error.message });
  }
}
