# VaultLink Secure File Hosting (Dynamic Links)

This version removes the old static hash-link model and uses a backend API for encrypted file storage.

## Security Model

- File encryption happens in the browser using **AES-256-GCM**.
- A **new random AES key** is generated for every upload.
- The encryption key is shown to the user and **never sent to the server**.
- The server stores only:
  - encrypted file bytes
  - metadata (`fileId`, `iv`, expiry, download limits, counters, file info)
- Each upload generates a **brand new random fileId** (`128-bit entropy`) and link:
  - `https://domain.com/f/<fileId>`

## Upload Flow

1. User selects a file (max `50MB`).
2. Browser generates:
   - random 256-bit AES-GCM key
   - random 12-byte IV
3. Browser encrypts file locally.
4. Frontend uploads only encrypted bytes + metadata to `POST /api/upload`.
5. Backend returns `{ fileId }`.
6. Frontend constructs dynamic link `/f/<fileId>` and shows key separately.

## Download Flow

When opening `/f/<fileId>`:

1. User pastes decryption key.
2. Frontend requests encrypted data from `GET /api/file/:fileId`.
3. Browser decrypts locally using AES-GCM.
4. Browser triggers file download.

Error conditions:

- Wrong key → decryption error.
- Expired file → server returns `410`.
- Download limit reached → server returns `410`.

## Backend API

### `POST /api/upload`

Multipart form fields:

- `encryptedFile` (required)
- `iv` (base64, 12 bytes decoded)
- `expiresInHours` (1..720)
- `maxDownloads` (1..1000)
- `originalName`
- `originalType`
- `originalSize` (1..50MB)

Response:

```json
{ "fileId": "8f3a91c7d2e44a12b8f1e9c4a7b0d3f2" }
```

### `GET /api/file/:fileId`

- Validates fileId format (`32 hex chars`).
- Checks expiry and download limit.
- Increments download counter on successful download.
- Deletes file if expired or exhausted.
- Returns encrypted bytes (`application/octet-stream`) and metadata headers:
  - `X-File-Iv`
  - `X-File-Name`
  - `X-File-Type`
  - `X-File-Size`

## File Metadata Schema

Each record in `storage/metadata.json` stores:

- `fileId`
- `filePath`
- `iv`
- `createdAt`
- `expiresAt`
- `maxDownloads`
- `downloadCount`
- `originalName`
- `originalType`
- `originalSize`

## Expiry and Deletion Rules

File is deleted when:

- `currentTime > expiresAt`
- or `downloadCount >= maxDownloads`

Cleanup happens:

- at startup (stale records)
- on file-access checks
- after final allowed download

## Security Controls

- AES-GCM only
- Random IV per upload (12 bytes)
- Random secure `fileId` from `crypto.randomBytes(16).toString('hex')`
- Max file size enforced at frontend and backend (`50MB`)
- MIME type validation on frontend and backend
- Rate limiting on `GET /api/file/:fileId`
- No encryption key logging or storage on backend

## Run Locally

```bash
npm install
npm start
```

Open:

- `http://localhost:3000/` for upload
- `http://localhost:3000/f/<fileId>` for download

## Project Files

- `index.html` → frontend UI + browser-side crypto logic
- `server.js` → Express backend API + storage lifecycle
- `storage/files/` → encrypted file blobs (runtime)
- `storage/metadata.json` → encrypted file metadata (runtime)
