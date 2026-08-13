import app, { connectDatabase } from '../server/src/app.js';

export default async function handler(req, res) {
  try {
    await connectDatabase();
    return app(req, res);
  } catch (error) {
    return res.status(503).json({ message: 'Database connection failed', error: error.message });
  }
}
