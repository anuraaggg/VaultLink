"use strict";

const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const ROOT_DIR = __dirname;
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const FILES_DIR = path.join(STORAGE_DIR, "files");
const METADATA_PATH = path.join(STORAGE_DIR, "metadata.json");

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MAX_RETENTION_HOURS = 24 * 30;
const MAX_DOWNLOAD_LIMIT = 1000;

const ALLOWED_MIME_PATTERNS = [
    /^image\//,
    /^text\//,
    /^audio\//,
    /^video\//,
    /^application\/pdf$/,
    /^application\/json$/,
    /^application\/zip$/,
    /^application\/x-zip-compressed$/,
    /^application\/x-7z-compressed$/,
    /^application\/x-rar-compressed$/,
    /^application\/octet-stream$/,
    /^application\/msword$/,
    /^application\/vnd\//,
];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES + 1024 },
});

const downloadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
});

const isAllowedMimeType = (mimeType) => {
    if (typeof mimeType !== "string" || mimeType.trim().length === 0) {
        return false;
    }
    return ALLOWED_MIME_PATTERNS.some((pattern) => pattern.test(mimeType));
};

const ensureStorage = async () => {
    await fs.mkdir(FILES_DIR, { recursive: true });
    try {
        await fs.access(METADATA_PATH);
    } catch {
        await fs.writeFile(METADATA_PATH, JSON.stringify({}, null, 2), "utf8");
    }
};

const readMetadata = async () => {
    const raw = await fs.readFile(METADATA_PATH, "utf8");
    return JSON.parse(raw || "{}");
};

const writeMetadata = async (metadata) => {
    await fs.writeFile(METADATA_PATH, JSON.stringify(metadata, null, 2), "utf8");
};

const isExpired = (record, now = Date.now()) => {
    return now > record.expiresAt;
};

const hasReachedDownloadLimit = (record) => {
    return record.downloadCount >= record.maxDownloads;
};

const cleanupRecord = async (metadata, fileId) => {
    const record = metadata[fileId];
    if (!record) return;

    try {
        await fs.unlink(record.filePath);
    } catch {
        // no-op if already removed
    }

    delete metadata[fileId];
};

const cleanupExpiredAndExhaustedFiles = async () => {
    const metadata = await readMetadata();
    const now = Date.now();
    const fileIds = Object.keys(metadata);

    for (const fileId of fileIds) {
        const record = metadata[fileId];
        if (!record) continue;

        if (isExpired(record, now) || hasReachedDownloadLimit(record)) {
            await cleanupRecord(metadata, fileId);
        }
    }

    await writeMetadata(metadata);
};

const generateUniqueFileId = async () => {
    const metadata = await readMetadata();
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const fileId = crypto.randomBytes(16).toString("hex");
        if (!metadata[fileId]) {
            return fileId;
        }
    }
    throw new Error("Failed to generate a unique file ID.");
};

app.use(express.static(ROOT_DIR, { index: false }));

app.post("/api/upload", upload.single("encryptedFile"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Encrypted file is required." });
        }

        const {
            iv,
            expiresInHours,
            maxDownloads,
            originalName,
            originalType,
            originalSize,
        } = req.body;

        const parsedExpiresInHours = Number.parseInt(expiresInHours, 10);
        const parsedMaxDownloads = Number.parseInt(maxDownloads, 10);
        const parsedOriginalSize = Number.parseInt(originalSize, 10);

        if (!Number.isInteger(parsedExpiresInHours) || parsedExpiresInHours < 1 || parsedExpiresInHours > MAX_RETENTION_HOURS) {
            return res.status(400).json({ error: "Invalid expiry value." });
        }

        if (!Number.isInteger(parsedMaxDownloads) || parsedMaxDownloads < 1 || parsedMaxDownloads > MAX_DOWNLOAD_LIMIT) {
            return res.status(400).json({ error: "Invalid max downloads value." });
        }

        if (!Number.isInteger(parsedOriginalSize) || parsedOriginalSize < 1 || parsedOriginalSize > MAX_FILE_SIZE_BYTES) {
            return res.status(400).json({ error: "Invalid file size. Max allowed is 50MB." });
        }

        if (typeof originalName !== "string" || originalName.trim().length === 0) {
            return res.status(400).json({ error: "Original file name is required." });
        }

        if (!isAllowedMimeType(originalType)) {
            return res.status(400).json({ error: "File type is not allowed." });
        }

        if (typeof iv !== "string") {
            return res.status(400).json({ error: "IV is required." });
        }

        let ivBuffer;
        try {
            ivBuffer = Buffer.from(iv, "base64");
        } catch {
            return res.status(400).json({ error: "Invalid IV format." });
        }

        if (ivBuffer.length !== 12) {
            return res.status(400).json({ error: "Invalid IV length. AES-GCM requires 12 bytes." });
        }

        const fileId = await generateUniqueFileId();
        const filePath = path.join(FILES_DIR, `${fileId}.bin`);
        const now = Date.now();
        const expiresAt = now + parsedExpiresInHours * 60 * 60 * 1000;

        await fs.writeFile(filePath, req.file.buffer);

        const metadata = await readMetadata();
        metadata[fileId] = {
            fileId,
            filePath,
            iv,
            createdAt: now,
            expiresAt,
            maxDownloads: parsedMaxDownloads,
            downloadCount: 0,
            originalName,
            originalType,
            originalSize: parsedOriginalSize,
        };

        await writeMetadata(metadata);

        return res.status(201).json({ fileId });
    } catch {
        return res.status(500).json({ error: "Upload failed." });
    }
});

app.get("/api/file/:fileId", downloadLimiter, async (req, res) => {
    try {
        const { fileId } = req.params;

        if (!/^[a-f0-9]{32}$/i.test(fileId)) {
            return res.status(400).json({ error: "Invalid file ID format." });
        }

        const metadata = await readMetadata();
        const record = metadata[fileId];

        if (!record) {
            return res.status(404).json({ error: "File not found." });
        }

        const now = Date.now();
        if (isExpired(record, now)) {
            await cleanupRecord(metadata, fileId);
            await writeMetadata(metadata);
            return res.status(410).json({ error: "This file has expired." });
        }

        if (hasReachedDownloadLimit(record)) {
            await cleanupRecord(metadata, fileId);
            await writeMetadata(metadata);
            return res.status(410).json({ error: "Download limit reached." });
        }

        let encryptedFileBuffer;
        try {
            encryptedFileBuffer = await fs.readFile(record.filePath);
        } catch {
            await cleanupRecord(metadata, fileId);
            await writeMetadata(metadata);
            return res.status(404).json({ error: "Encrypted file not available." });
        }

        record.downloadCount += 1;
        const shouldDeleteAfterThisDownload = hasReachedDownloadLimit(record);

        if (shouldDeleteAfterThisDownload) {
            await cleanupRecord(metadata, fileId);
        } else {
            metadata[fileId] = record;
        }

        await writeMetadata(metadata);

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("X-File-Iv", record.iv);
        res.setHeader("X-File-Name", encodeURIComponent(record.originalName));
        res.setHeader("X-File-Type", record.originalType || "application/octet-stream");
        res.setHeader("X-File-Size", String(record.originalSize));
        return res.status(200).send(encryptedFileBuffer);
    } catch {
        return res.status(500).json({ error: "Download failed." });
    }
});

app.get("/f/:fileId", (_req, res) => {
    res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/", (_req, res) => {
    res.sendFile(path.join(ROOT_DIR, "index.html"));
});

const start = async () => {
    await ensureStorage();
    await cleanupExpiredAndExhaustedFiles();

    app.listen(PORT, () => {
        console.log(`Secure file host running on http://localhost:${PORT}`);
    });
};

start().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});