# Deploying Aether (free, about 15 minutes, once)

Aether runs entirely on Cloudflare's **free plan**. You don't need a credit card, a server or your own PC.

| Piece | Cloudflare product | Free allowance | A 20-person lab uses |
|---|---|---|---|
| Web app + API | Workers + static assets | 100,000 requests/day | ~10–20k |
| Database | D1 (SQLite) | 5 GB, 5M row reads/day | a few MB |
| Realtime chat & live updates | Durable Objects (SQLite, hibernating WebSockets) | included | ✓ |
| Hourly reminders | Cron Triggers | included | 24/day |

After the one-time setup below, **every push to `main` deploys automatically**.

---

## 1. Create a Cloudflare account

1. Sign up at <https://dash.cloudflare.com/sign-up>. You only need an email address.
2. Open **Workers & Pages** once in the dashboard. This claims your free `*.workers.dev` subdomain, for example `your-name.workers.dev`.

## 2. Create an API token

1. In the dashboard, open **My Profile → API Tokens → Create Token**.
2. Choose the **Edit Cloudflare Workers** template.
3. Click **+ Add more**, then add **Account → D1 → Edit**.
4. For **Account Resources**, choose *your account*. For **Zone Resources**, choose *All zones*.
5. Create the token and copy it.
6. Copy your **Account ID** as well. It's shown on the right of the Workers & Pages overview page.

## 3. Give the token to GitHub

In the repository on GitHub, go to **Settings → Secrets and variables → Actions → New repository secret**. Add two secrets:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | your account ID |

## 4. Deploy

Go to **Actions → Deploy to Cloudflare → Run workflow**. Pushing to `main` also triggers it.

The workflow (`scripts/deploy.mjs`) does the following:

- creates the `aether-db` database if it doesn't exist yet
- applies database migrations
- builds the app and deploys the Worker
- generates the encryption key (`APP_SECRET`) on the first deploy only

When it finishes, your workspace is live at:

```
https://aether.<your-subdomain>.workers.dev
```

Open it and create the workspace. The first person to do so becomes the **Owner**.

> To deploy from your own machine instead, run `npx wrangler login` once, then `node scripts/deploy.mjs`.

---

## 5. Email invites (Gmail, free)

1. In your Google Account, open **Security** and turn on **2-Step Verification**.
2. Go to **Security → App passwords**, create one named **Aether**, and copy the 16-character code.
3. In Aether, open **Settings → Email delivery** and fill in:
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address
   - App password: the 16-character code
4. Click **Save & send test email**.

The App Password is encrypted before it is stored and is never sent back to the browser. Gmail allows roughly 500 messages a day.

Then go to **Settings → Team & roles**. Enter an email address, pick a role and click **Send invite**. The person receives a link, sets a password, and they're in. If email isn't configured yet, Aether shows the link so you can send it yourself.

## 6. GitHub integration (free)

1. On GitHub, open **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Fill in:
   - **Homepage URL:** your Aether URL
   - **Authorization callback URL:** `https://<your Aether URL>/api/github/callback`. **Settings → GitHub** in Aether shows the exact value with a copy button.
3. Create the app, then click **Generate a new client secret**.
4. In Aether, open **Settings → GitHub** and paste the client ID and secret.
5. Each member clicks **Connect GitHub**.

Each person acts with their own GitHub permissions. Inside Aether they can:

- browse repositories
- edit files and commit, including multi-file commits
- create repositories and branches
- open and merge pull requests
- watch Actions runs

Linking a repository to a project installs a webhook. Commits that mention `SAA-12` link to that task, and `fixes SAA-12` completes it, either in a commit or in a merged PR's description. CI failures notify the project lead.

## 7. Desktop app

Desktop installers are built by GitHub Actions, on GitHub's free runners:

1. Go to **Actions → Desktop app → Run workflow**, or push a tag like `desktop-v1.0.0`.
2. When it finishes, the **Releases** page has:
   - `Aether-Setup-x.y.z.exe` (Windows)
   - `Aether-x.y.z-arm64.dmg` and the x64 `.dmg` (macOS)
   - `.AppImage` and `.deb` (Linux)
3. Install it and enter your workspace URL on first launch.

The installers aren't code-signed, because signing certificates cost money:

- **Windows** shows a SmartScreen prompt. Click **More info → Run anyway**.
- **macOS** blocks the first launch. Right-click the app, choose **Open**, then confirm.

## Backups

- **Settings → Data & audit log → Download export** saves everything as JSON.
- D1 also keeps point-in-time recovery (7 days on the free plan). Restore with:

  ```bash
  npx wrangler d1 time-travel restore aether-db --timestamp <ISO time>
  ```

## Local development

```bash
npm install
npm run db:migrate:local
npm run build && npx wrangler dev   # http://localhost:8787 — app + API + realtime, fully offline
npm run dev                         # or: hot-reloading UI on :5173 proxied to the API on :8787
node test/e2e.mjs                   # end-to-end test (needs Playwright)
```
