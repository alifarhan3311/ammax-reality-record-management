import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import app, { connectDatabase } from './app.js';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(serverDirectory, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

const port = process.env.PORT || 5050;
connectDatabase()
  .then(connection => {
    console.log(`MongoDB connected: ${connection.name}`);
    app.listen(port, () => console.log(`App running on http://localhost:${port}`));
  })
  .catch(error => {
    console.error('Server could not start:', error.message);
    process.exit(1);
  });
