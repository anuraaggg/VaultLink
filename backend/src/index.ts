import dotenv from "dotenv";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import { rateLimit } from "express-rate-limit";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { FileRecord, type FileRecordDocument } from "./models/FileRecord";
import { runStartupCleanup } from "./utils/cleanup";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();
const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const mongoUri = process.env.MONGODB_URI;
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

const maxFileSizeBytes = 50 * 1024 * 1024;
const maxRetentionMinutes = 60;
const maxDownloadLimit = 1000;

const s3Region = process.env.S3_REGION;
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3AccessKeyId = process.env.S3_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";

const s3Client = new S3Client({
  region: s3Region,
  endpoint: s3Endpoint,
  forcePathStyle: s3ForcePathStyle,
  credentials:
    s3AccessKeyId && s3SecretAccessKey
      ? {
          accessKeyId: s3AccessKeyId,
          secretAccessKey: s3SecretAccessKey,
        }
      : undefined,
});

const allowedMimePatterns: RegExp[] = [
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
  limits: { fileSize: maxFileSizeBytes + 16 * 1024 },
});

const fileReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const isAllowedMimeType = (mimeType: string): boolean => {
  return allowedMimePatterns.some((pattern) => pattern.test(mimeType));
};

const ensureStorageReady = async (): Promise<void> => {
  if (!s3Bucket || !s3Region || !s3Endpoint || !s3AccessKeyId || !s3SecretAccessKey) {
    throw new Error("S3 configuration is incomplete.");
  }
};

type StoredFileLocation = {
  storageKey: string;
};

const writeEncryptedFile = async (fileId: string, data: Buffer): Promise<StoredFileLocation> => {
  if (!s3Bucket) {
    throw new Error("S3 bucket is not configured.");
  }

  const storageKey = `uploads/${fileId}.bin`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: storageKey,
      Body: data,
      ContentType: "application/octet-stream",
    }),
  );

  return { storageKey };
};

const readEncryptedFile = async (record: FileRecordDocument): Promise<Buffer> => {
  if (!s3Bucket || !record.storageKey) {
    throw new Error("S3 file metadata/configuration is incomplete.");
  }

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: s3Bucket,
      Key: record.storageKey,
    }),
  );

  if (!response.Body) {
    throw new Error("S3 object is empty.");
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
};

const deleteStoredFile = async (record: FileRecordDocument): Promise<void> => {
  if (!s3Bucket || !record.storageKey) {
    return;
  }

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: s3Bucket,
        Key: record.storageKey,
      }),
    );
  } catch {
    // ignore missing object / transient delete errors
  }
};

const isExpired = (expiresAt: Date): boolean => Date.now() > expiresAt.getTime();

app.use(
  cors({
    origin: frontendOrigin,
    exposedHeaders: ["X-File-Iv", "X-File-Name", "X-File-Type", "X-File-Size"],
  }),
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/upload", upload.single("encryptedFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Encrypted file is required." });
    }

    const iv = String(req.body.iv ?? "");
    const expiresInMinutes = Number.parseInt(String(req.body.expiresInMinutes ?? ""), 10);
    const maxDownloads = Number.parseInt(String(req.body.maxDownloads ?? ""), 10);
    const originalName = String(req.body.originalName ?? "").trim();
    const originalType = String(req.body.originalType ?? "").trim();
    const originalSize = Number.parseInt(String(req.body.originalSize ?? ""), 10);

    if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > maxRetentionMinutes) {
      return res.status(400).json({ error: "Invalid expiry value." });
    }

    if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > maxDownloadLimit) {
      return res.status(400).json({ error: "Invalid max downloads value." });
    }

    if (!Number.isInteger(originalSize) || originalSize < 1 || originalSize > maxFileSizeBytes) {
      return res.status(400).json({ error: "Invalid file size. Max allowed is 50MB." });
    }

    if (originalName.length === 0) {
      return res.status(400).json({ error: "Original file name is required." });
    }

    if (!isAllowedMimeType(originalType)) {
      return res.status(400).json({ error: "File type is not allowed." });
    }

    if (iv.length === 0) {
      return res.status(400).json({ error: "IV is required." });
    }

    const ivBuffer = Buffer.from(iv, "base64");
    if (ivBuffer.length !== 12) {
      return res.status(400).json({ error: "Invalid IV length. AES-GCM requires 12 bytes." });
    }

    const fileId = crypto.randomBytes(16).toString("hex");
    const storageLocation = await writeEncryptedFile(fileId, req.file.buffer);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + expiresInMinutes * 60 * 1000);

    await FileRecord.create({
      fileId,
      storageKey: storageLocation.storageKey,
      storageProvider: "s3",
      iv,
      createdAt,
      expiresAt,
      maxDownloads,
      downloadCount: 0,
      originalName,
      originalType,
      originalSize,
    });

    return res.status(201).json({ fileId });
  } catch {
    return res.status(500).json({ error: "Upload failed." });
  }
});

app.get("/api/file/:fileId", fileReadLimiter, async (req, res) => {
  try {
    const rawFileId = req.params.fileId;
    const fileId = Array.isArray(rawFileId) ? rawFileId[0] : rawFileId;
    if (!/^[a-f0-9]{32}$/i.test(fileId)) {
      return res.status(400).json({ error: "Invalid file ID format." });
    }

    const record = await FileRecord.findOne({ fileId });
    if (!record) {
      return res.status(404).json({ error: "File not found." });
    }

    if (isExpired(record.expiresAt)) {
      await deleteStoredFile(record);
      await FileRecord.deleteOne({ _id: record._id });
      return res.status(410).json({ error: "This file has expired." });
    }

    if (record.downloadCount >= record.maxDownloads) {
      await deleteStoredFile(record);
      await FileRecord.deleteOne({ _id: record._id });
      return res.status(410).json({ error: "Download limit reached." });
    }

    const encryptedBuffer = await readEncryptedFile(record);
    record.downloadCount += 1;
    const reachedLimit = record.downloadCount >= record.maxDownloads;

    if (reachedLimit) {
      await deleteStoredFile(record);
      await FileRecord.deleteOne({ _id: record._id });
    } else {
      await record.save();
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-File-Iv", record.iv);
    res.setHeader("X-File-Name", encodeURIComponent(record.originalName));
    res.setHeader("X-File-Type", record.originalType);
    res.setHeader("X-File-Size", String(record.originalSize));

    return res.status(200).send(encryptedBuffer);
  } catch {
    return res.status(500).json({ error: "Download failed." });
  }
});

const start = async (): Promise<void> => {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is required in backend environment configuration.");
  }

  await ensureStorageReady();
  await mongoose.connect(mongoUri);
  await runStartupCleanup(deleteStoredFile);

  app.listen(port, () => {
    console.log(`VaultLink backend running at http://localhost:${port}`);
  });
};

start().catch((error) => {
  console.error("Failed to start backend:", error);
  process.exit(1);
});
