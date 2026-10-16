# AMMAX Transaction Records

MERN transaction record manager styled after the AMMAX Realty brand.

## Run locally

1. Run `npm install`, `npm install --prefix client`, and `npm install --prefix server`.
2. MongoDB must be running. The included `server/.env` connects to the local `ammax-records` database.
3. Run `npm run dev` and open `http://localhost:5050`.

Both the React client and Express API run through the same port. Nodemon watches both `client/src` and `server/src`; it rebuilds the client and restarts the server when either changes.

All transaction create, list, and detail requests persist to and load from MongoDB. The server will not start if MongoDB is unavailable, preventing accidental temporary data loss.

## Google Drive checklist uploads

The app uses Google OAuth for checklist uploads to a normal My Drive folder. Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, and `GOOGLE_DRIVE_FOLDER_ID`. Checklist attachments are uploaded to that folder; the Drive file ID and metadata are saved in MongoDB.

On Vercel, checklist uploads are limited to 4 MB per file because files pass through a serverless function.

## Deploy to Vercel

1. Push the complete repository to GitHub, GitLab, or Bitbucket.
2. Import the repository in Vercel. Keep the project Root Directory set to the repository root.
3. Framework preset may remain `Other`; `vercel.json` supplies the build and routing configuration.
4. Add these Vercel Environment Variables for Production, Preview, and Development:
   - `MONGO_URI`: use a MongoDB Atlas connection string. `127.0.0.1` will not work on Vercel.
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`
   - `GOOGLE_OAUTH_REFRESH_TOKEN`
   - `GOOGLE_DRIVE_FOLDER_ID`
   - `JWT_SECRET`: a long random value used to sign secure login sessions.
   - `ADMIN_NAME`: the initial administrator's display name.
   - `ADMIN_EMAIL`: the initial administrator's login email.
   - `ADMIN_PASSWORD`: a strong initial administrator password (minimum 8 characters).
   - `SMTP_HOST`: use `smtp.gmail.com` for Gmail.
   - `SMTP_PORT`: use `465` with secure SMTP.
   - `SMTP_SECURE`: use `true` with port 465.
   - `SMTP_USER`: the Gmail address that sends notifications.
   - `SMTP_PASS`: the Gmail account's 16-character Google App Password, not its normal password.
   - `EMAIL_FROM`: display name plus the same Gmail sender address.
   - `APP_URL`: the production Vercel URL, without a trailing slash.
   - `CRON_SECRET`: a long random value used to protect the scheduled reminder endpoint.
5. In MongoDB Atlas Network Access, allow Vercel connectivity. For a simple setup use `0.0.0.0/0` with a strong database user/password; a managed fixed-egress setup is safer for production.
6. Deploy. Verify `/api/health`, then create and reload a transaction.

The React SPA is served from `client/dist`, while `/api/*` is handled by the Vercel serverless Express function in `api/index.js`.

If Vercel reports `FUNCTION_INVOCATION_TIMEOUT`, verify that `MONGO_URI` is an Atlas URI with the database name, its username/password are current and URL-encoded, and Atlas Network Access permits Vercel. Database connection attempts fail with a JSON `503` response after five seconds instead of hanging until the platform timeout.

## Authentication and access control

- Public signup is disabled. Administrators create, deactivate, reactivate, and reset passwords for agent accounts.
- A newly created or reset agent account must replace its temporary password at the next login.
- Agents only see and modify their assigned transactions. Admins can review every transaction and change checklist statuses.
- The API enforces ownership for list, detail, update, contacts, commission, checklist, export, and Drive operations.
- The agent commission view stops before Referral Details; those fields remain admin-only on both the client and API.
- Admin checklist status changes generate an immediate agent email. Two daily Vercel slots cover `04:00` and `05:00 UTC`; the server sends each agent's Required/Incomplete reminder only when that slot is midnight Toronto time (`America/Toronto`). This supports daylight-saving changes and Vercel Hobby's daily-only cron limit.
- On startup, the account matching `ADMIN_EMAIL` is created/promoted to admin. Legacy users become agents and legacy transactions are assigned to their original creator.
- Authentication uses a seven-day JWT stored in an HTTP-only cookie. Never commit `JWT_SECRET`, `CRON_SECRET`, email credentials, or admin credentials to GitHub.
