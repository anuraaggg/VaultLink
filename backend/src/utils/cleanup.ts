import { FileRecord, type FileRecordDocument } from "../models/FileRecord";

type DeleteStoredFile = (record: FileRecordDocument & { _id: unknown }) => Promise<void>;

export const runStartupCleanup = async (deleteStoredFile: DeleteStoredFile): Promise<void> => {
  const now = new Date();
  const expiredOrExhausted = await FileRecord.find({
    $or: [{ expiresAt: { $lt: now } }, { $expr: { $gte: ["$downloadCount", "$maxDownloads"] } }],
  });

  for (const record of expiredOrExhausted) {
    await deleteStoredFile(record);
  }

  if (expiredOrExhausted.length > 0) {
    await FileRecord.deleteMany({ _id: { $in: expiredOrExhausted.map((doc) => doc._id) } });
  }
};
