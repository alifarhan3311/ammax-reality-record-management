# AMMAX Transaction Records

MERN transaction record manager styled after the AMMAX Realty brand.

## Run locally

1. Run `npm install`, `npm install --prefix client`, and `npm install --prefix server`.
2. MongoDB must be running. The included `server/.env` connects to the local `ammax-records` database.
3. Run `npm run dev` and open `http://localhost:5050`.

Both the React client and Express API run through the same port. Nodemon watches both `client/src` and `server/src`; it rebuilds the client and restarts the server when either changes.

All transaction create, list, and detail requests persist to and load from MongoDB. The server will not start if MongoDB is unavailable, preventing accidental temporary data loss.

## Google Drive checklist uploads

Create a Google Cloud service account, enable Google Drive API, and share the target Drive folder with the service account email as Editor. Add `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, and `GOOGLE_DRIVE_FOLDER_ID` to `server/.env`. Checklist attachments are uploaded to that folder; the Drive file ID and link are saved in MongoDB.

On Vercel, checklist uploads are limited to 4 MB per file because files pass through a serverless function.

## Deploy to Vercel

1. Push the complete repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in Vercel. Keep the project Root Directory set to the repository root.
3. Framework preset may remain `Other`; `vercel.json` supplies the build and routing configuration.
4. Add these Vercel Environment Variables for Production, Preview, and Development:
   - `MONGO_URI`: use a MongoDB Atlas connection string. `127.0.0.1` will not work on Vercel.
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY` (paste the complete private key, including BEGIN/END lines)
   - `GOOGLE_DRIVE_FOLDER_ID`
   - `JWT_SECRET`: a long random value used to sign secure login sessions.
   - `ADMIN_NAME`: the initial administrator's display name.
   - `ADMIN_EMAIL`: the initial administrator's login email.
   - `ADMIN_PASSWORD`: a strong initial administrator password (minimum 8 characters).
5. In MongoDB Atlas Network Access, allow Vercel connectivity. For a simple setup use `0.0.0.0/0` with a strong database user/password; a managed fixed-egress setup is safer for production.
6. Deploy. Verify `/api/health`, then create and reload a transaction.

The React SPA is served from `client/dist`, while `/api/*` is handled by the Vercel serverless Express function in `api/index.js`.

If Vercel reports `FUNCTION_INVOCATION_TIMEOUT`, verify that `MONGO_URI` is an Atlas URI with the database name, its username/password are current and URL-encoded, and Atlas Network Access permits Vercel. Database connection attempts fail with a JSON `503` response after five seconds instead of hanging until the platform timeout.

## Authentication and access control

- Public signup always creates a normal `user`; it can never create an admin.
- Users only see and modify transactions whose `createdBy` matches their account.
- Admins can see and manage every user's transactions, including owner name/email in the list.
- Ownership is enforced by the API for list, detail, update, delete, contacts, commission, checklist, and Drive uploads.
- On startup, the account matching `ADMIN_EMAIL` is created/promoted to admin. Existing transactions without an owner are assigned to this initial admin.
- Authentication uses a seven-day JWT stored in an HTTP-only cookie. Never commit `JWT_SECRET` or admin credentials to GitHub.
