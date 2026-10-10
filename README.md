# CampusLink on Render

This bundle serves the frontend and API from one Node web service. It starts with an empty student roster and empty resources/transfers; it does not include the Desktop database or uploaded files. Set the teacher password as a Render secret, then sign in as a teacher and register students with individual passwords.

## Deploy

1. Sign in to Render, then open the [one-click deploy link](https://render.com/deploy?repo=https://github.com/diajohny10/campuslink-render-deployment).
2. Review the Blueprint and set the `TEACHER_PASSWORD` secret to a strong password. Do not commit a `.env` file or put the secret in the repository.
3. Create the service. Render will build the Node app and provide an `onrender.com` URL when deployment finishes.
4. Open that URL, choose a teacher subject, sign in with the secret you set, and register students with their own passwords.

The Blueprint uses Render's Free web service, which provides a stable public URL without a paid plan. Free services sleep after 15 minutes of inactivity and take about a minute to start again. Their filesystem is ephemeral: student registrations, uploaded resources, and transfers can be lost when the service sleeps, restarts, or redeploys. Use this deployment as a link/demo only; choose a paid service and persistent storage before relying on retained data. See Render's current [free service limits](https://render.com/docs/free).

## Local run

From `backend`, run `npm ci`, set `TEACHER_PASSWORD` in your environment, and run `npm start`. For PowerShell, use `$env:TEACHER_PASSWORD = 'your-strong-password'` before `npm start`. Open `http://localhost:5000` and register students from the teacher portal.

## Important limits

- Student passwords are stored as scrypt hashes. Existing plaintext password entries are rejected.
- Sessions are held in memory and expire after eight hours, so users sign in again after a service restart.
- The app has no password reset flow, rate limiting, or managed database. Review those needs before using real student records.
