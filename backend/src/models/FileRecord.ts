import { Schema, model, type InferSchemaType } from "mongoose";

const fileRecordSchema = new Schema(
  {
    fileId: { type: String, required: true, unique: true, index: true },
    storageProvider: { type: String, required: true, enum: ["s3"], default: "s3" },
    storageKey: { type: String, required: true },
    iv: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    maxDownloads: { type: Number, required: true },
    downloadCount: { type: Number, required: true, default: 0 },
    originalName: { type: String, required: true },
    originalType: { type: String, required: true },
    originalSize: { type: Number, required: true },
  },
  { versionKey: false }
);

export type FileRecordDocument = InferSchemaType<typeof fileRecordSchema>;

export const FileRecord = model("FileRecord", fileRecordSchema);
