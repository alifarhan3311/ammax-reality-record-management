import app, { bootstrapAdmin, connectDatabase } from '../server/src/app.js';

export default async function handler(req, res) {
  try {
    await connectDatabase();
    await bootstrapAdmin();
    return app(req, res);
  } catch (error) {
    return res.status(503).json({ message: 'Database connection failed', error: error.message });
  }
}
