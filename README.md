# Allegro Ads Automate

Chrome extension for automating and optimizing Allegro Ads campaign management.

## Project Structure

```
/
├── extension/          # Chrome Extension (Manifest V3)
│   ├── src/
│   │   ├── background/ # Service Worker
│   │   ├── content/    # Content Scripts
│   │   └── popup/      # React Popup UI
│   └── manifest.json
├── backend/            # Node.js + Express API
│   └── src/
│       ├── routes/
│       ├── db/
│       └── middleware/
```

## MVP Features

- **Global CPC/Budget Changes** – Change all campaign bids in one action
- **CPC Scheduler** – Automatic bid adjustments by day/hour
- **License Management** – Backend validation with Stripe integration
- **Change History** – Full audit log with one-click undo

## Quick Start

### Extension

```bash
cd extension
npm install
npm run build
# Load dist/ folder in Chrome (chrome://extensions → Load unpacked)
```

### Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials
npm run migrate
npm start
```

## Tech Stack

- **Extension**: JavaScript + React 18, Chrome Manifest V3, Webpack 5
- **Backend**: Node.js, Express, PostgreSQL
- **Payments**: Stripe Checkout + Webhooks
- **Hosting**: Hetzner CX22 (Germany, GDPR compliant)