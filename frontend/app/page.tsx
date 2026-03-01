"use client";

import { useMemo, useState } from "react";
import { toBase64, toBase64Url } from "@/lib/crypto";
import VaultMark from "@/components/VaultMark";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

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

const isAllowedMimeType = (mimeType: string): boolean => {
  return allowedMimePatterns.some((pattern) => pattern.test(mimeType));
};

export default function UploadPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [expiresInMinutes, setExpiresInMinutes] = useState<number>(15);
  const [maxDownloads, setMaxDownloads] = useState<number>(3);
  const [resultLink, setResultLink] = useState<string>("");
  const [resultKey, setResultKey] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  const canSubmit = useMemo(() => {
    return (
      !!selectedFile &&
      !isLoading &&
      Number.isInteger(expiresInMinutes) &&
      Number.isInteger(maxDownloads) &&
      expiresInMinutes >= 1 &&
      expiresInMinutes <= 60 &&
      maxDownloads >= 1 &&
      maxDownloads <= 1000
    );
  }, [selectedFile, isLoading, expiresInMinutes, maxDownloads]);

  const onSelectFile = (file: File | null) => {
    setError("");
    setResultLink("");
    setResultKey("");

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.size === 0) {
      setError("File is empty.");
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError("Max file size is 50MB.");
      setSelectedFile(null);
      return;
    }

    if (!isAllowedMimeType(file.type)) {
      setError("File type is not allowed.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setError("");
    setStatus("Reading file...");
    setIsLoading(true);

    try {
      const plainData = await selectedFile.arrayBuffer();
      setStatus("Generating key...");

      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const rawKeyBuffer = await crypto.subtle.exportKey("raw", key);
      const rawKeyBytes = new Uint8Array(rawKeyBuffer);
      const userKey = toBase64Url(rawKeyBytes);

      setStatus("Encrypting in browser...");
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encryptedData = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainData);

      setStatus("Uploading encrypted file...");
      const encryptedBlob = new Blob([encryptedData], { type: "application/octet-stream" });

      const formData = new FormData();
      formData.append("encryptedFile", encryptedBlob, `${selectedFile.name}.enc`);
      formData.append("iv", toBase64(iv));
      formData.append("expiresInMinutes", String(expiresInMinutes));
      formData.append("maxDownloads", String(maxDownloads));
      formData.append("originalName", selectedFile.name);
      formData.append("originalType", selectedFile.type || "application/octet-stream");
      formData.append("originalSize", String(selectedFile.size));

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        body: formData,
      });

      const data = (await response.json()) as { fileId?: string; error?: string };
      if (!response.ok || !data.fileId) {
        throw new Error(data.error ?? "Upload failed.");
      }

      const link = `${window.location.origin}/f/${data.fileId}`;
      setResultLink(link);
      setResultKey(userKey);
      setStatus("Upload complete.");
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed.";
      setError(message);
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${label} copied.`);
    } catch {
      setError(`Failed to copy ${label.toLowerCase()}.`);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center p-6">
      <div className="mb-2 flex items-center gap-3">
        <VaultMark className="h-10 w-10" />
        <h1 className="text-3xl font-bold tracking-tight text-neutral-100">VaultLink</h1>
      </div>
      <p className="mb-6 text-sm font-medium text-neutral-300">Private file sharing with local AES-256-GCM encryption.</p>

      <section className="rounded-2xl border border-neutral-800 bg-black/80 p-6 backdrop-blur">
        <h2 className="mb-4 text-lg font-semibold text-neutral-100">Encrypt & Upload</h2>

        <label className="mb-3 block text-sm font-medium text-neutral-200">Select file (max 50MB)</label>
        <input
          suppressHydrationWarning
          className="mb-4 block w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm font-medium text-neutral-100 outline-none focus:border-neutral-500"
          type="file"
          onChange={(event) => onSelectFile(event.target.files?.[0] ?? null)}
        />

        {selectedFile && (
          <div className="mb-4 rounded-lg border border-neutral-800 bg-black p-3 text-xs font-medium text-neutral-200">
            <p>Name: {selectedFile.name}</p>
            <p>Type: {selectedFile.type || "application/octet-stream"}</p>
            <p>Size: {selectedFile.size} bytes</p>
          </div>
        )}

        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-300">Expiry minutes (1-60)</label>
            <input
              suppressHydrationWarning
              className="w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm font-medium text-neutral-100 outline-none focus:border-neutral-500"
              type="number"
              min={1}
              max={60}
              value={expiresInMinutes}
              onChange={(event) => setExpiresInMinutes(Number.parseInt(event.target.value || "0", 10))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-300">Max downloads (1-1000)</label>
            <input
              suppressHydrationWarning
              className="w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm font-medium text-neutral-100 outline-none focus:border-neutral-500"
              type="number"
              min={1}
              max={1000}
              value={maxDownloads}
              onChange={(event) => setMaxDownloads(Number.parseInt(event.target.value || "0", 10))}
            />
          </div>
        </div>

        <button
          onClick={handleUpload}
          disabled={!canSubmit}
          className="w-full rounded-lg bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Processing..." : "Encrypt in browser & upload"}
        </button>

        {status && <p className="mt-3 text-xs text-emerald-400">{status}</p>}
        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      </section>

      {resultLink && resultKey && (
        <section className="mt-6 rounded-2xl border border-neutral-800 bg-black/80 p-6 backdrop-blur">
          <h2 className="mb-3 text-lg font-semibold text-neutral-100">Share manually</h2>
          <p className="mb-4 text-xs font-medium text-neutral-300">Send link and key together through your own channel. The key is never sent to backend.</p>

          <div className="mb-3">
            <p className="mb-1 text-xs font-medium text-neutral-300">Link</p>
            <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-black p-3 text-xs font-medium text-neutral-100">{resultLink}</pre>
            <button
              className="mt-2 rounded-lg border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:bg-neutral-900"
              onClick={() => copy(resultLink, "Link")}
            >
              Copy link
            </button>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-neutral-300">Decryption key</p>
            <pre className="overflow-x-auto rounded-lg border border-neutral-800 bg-black p-3 text-xs font-medium text-neutral-100">{resultKey}</pre>
            <button
              className="mt-2 rounded-lg border border-neutral-700 px-3 py-1 text-xs font-semibold text-neutral-100 transition hover:bg-neutral-900"
              onClick={() => copy(resultKey, "Key")}
            >
              Copy key
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
