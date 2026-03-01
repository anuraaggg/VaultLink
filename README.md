# VaultLink

VaultLink is a dynamic encrypted file sharing app with:

- **Frontend**: Next.js + TypeScript + Tailwind + Web Crypto API
- **Backend**: Node.js + Express + TypeScript + MongoDB
- **Encrypted file storage**: S3-compatible object storage

## Security Model

- Every upload generates a brand new random `fileId` (`128-bit` entropy).
- Every upload generates a brand new random AES-256-GCM key in browser.
- Encryption key is never sent to backend.
- Backend stores only encrypted bytes + metadata.
- Dynamic link format is `https://domain.com/f/<fileId>`.

## Tech Stack

### Frontend (`frontend/`)

- Next.js App Router
- TypeScript
- Tailwind CSS
- Web Crypto API (`crypto.subtle`) for AES-GCM encryption/decryption

### Backend (`backend/`)

- Node.js + Express
- TypeScript
- MongoDB (Mongoose)
- Multer for encrypted file uploads
- Rate limiting on file fetch route

## Backend API

### `POST /api/upload`

Accepts multipart form data:

- `encryptedFile`
- `iv` (base64, 12 bytes)
- `expiresInMinutes` (1-60)
- `maxDownloads`
- `originalName`
- `originalType`
- `originalSize`

Returns:

```json
{ "fileId": "<random-hex-id>" }
```

### `GET /api/file/:fileId`

- Validates secure `fileId`
- Checks expiry and max downloads
- Increments `downloadCount`
- Returns encrypted bytes + metadata headers
- Deletes expired/exhausted files

### `GET /api/health`

- Health check endpoint

## Metadata Stored in MongoDB

- `fileId`
- `storageProvider` (`s3`)
- `storageKey` (S3 object key)
- `iv`
- `createdAt`
- `expiresAt`
- `maxDownloads`
- `downloadCount`
- `originalName`
- `originalType`
- `originalSize`

## Expiry/Deletion Rules

File is removed when:

- `currentTime > expiresAt`, or
- `downloadCount >= maxDownloads`

Encrypted binary files are stored in S3-compatible object storage.

## Local Development

### 1) Environment

Create a single root `.env` file with:

```dotenv
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/vaultlink
FRONTEND_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000

# Required: S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO, etc.)
S3_REGION=ap-south-1
S3_BUCKET=vaultlink-crypto
S3_ENDPOINT=https://s3.ap-south-1.amazonaws.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
```

### 2) Install deps

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

### 3) Start both apps

```bash
npm run dev
```

Frontend: `http://localhost:3000`

Backend: `http://localhost:4000`

## Project Structure

- `frontend/` → Next.js TypeScript Tailwind app
- `backend/` → Express TypeScript MongoDB API
