"use client";

import { use, useMemo, useState } from "react";
import { fromBase64, fromBase64Url } from "@/lib/crypto";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export default function FileDecryptPage({ params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = use(params);
  const [keyText, setKeyText] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const isValidFileId = useMemo(() => /^[a-f0-9]{32}$/i.test(fileId), [fileId]);

  const decrypt = async () => {
    setError("");
    setStatus("");

    if (!isValidFileId) {
      setError("Invalid file ID.");
      return;
    }

    if (!keyText.trim()) {
      setError("Please paste decryption key.");
      return;
    }

    setIsLoading(true);
    setStatus("Fetching encrypted file...");

    try {
      const response = await fetch(`${API_BASE}/api/file/${fileId}`);

      if (!response.ok) {
        let message = "Could not fetch file.";
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // ignore parse errors
        }
        throw new Error(message);
      }

      const ivHeader = response.headers.get("X-File-Iv");
      const fileNameHeader = response.headers.get("X-File-Name") ?? "download.bin";
      const fileTypeHeader = response.headers.get("X-File-Type") ?? "application/octet-stream";

      if (!ivHeader) {
        throw new Error("Invalid server response: missing IV.");
      }

      setStatus("Importing decryption key...");
      const keyBytes = fromBase64Url(keyText.trim());
      if (keyBytes.length !== 32) {
        throw new Error("Invalid key length. Expected AES-256 key.");
      }

      const keyMaterial = new Uint8Array(keyBytes).slice().buffer;

      const cryptoKey = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["decrypt"]);
      const iv = fromBase64(ivHeader);
      const ivSource: BufferSource = iv as unknown as BufferSource;
      const encryptedData = await response.arrayBuffer();

      setStatus("Decrypting in browser...");
      let decryptedData: ArrayBuffer;
      try {
        decryptedData = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivSource }, cryptoKey, encryptedData);
      } catch {
        throw new Error("Wrong key or corrupted encrypted data.");
      }

      setStatus("Preparing download...");
      const blob = new Blob([decryptedData], { type: fileTypeHeader });
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = decodeURIComponent(fileNameHeader);
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(blobUrl);

      setStatus("Download complete.");
    } catch (decryptError) {
      const message = decryptError instanceof Error ? decryptError.message : "Decryption failed.";
      setError(message);
      setStatus("");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center p-6">
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-neutral-100">VaultLink</h1>
      <p className="mb-6 text-sm font-medium text-neutral-300">Decrypt file locally in your browser.</p>

      <section className="rounded-2xl border border-neutral-800 bg-black/80 p-6 backdrop-blur">
        <h2 className="mb-3 text-lg font-semibold text-neutral-100">Decrypt & Download</h2>
        <p className="mb-3 text-xs font-medium text-neutral-300">File ID: {fileId}</p>

        <label className="mb-2 block text-sm font-medium text-neutral-200">Decryption key</label>
        <input
          type="text"
          value={keyText}
          onChange={(event) => setKeyText(event.target.value)}
          placeholder="Paste key sent by uploader"
          className="mb-4 w-full rounded-lg border border-neutral-700 bg-black px-3 py-2 text-sm font-medium text-neutral-100 outline-none focus:border-neutral-500"
        />

        <button
          disabled={isLoading || !isValidFileId}
          onClick={decrypt}
          className="w-full rounded-lg bg-neutral-100 px-4 py-2 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLoading ? "Decrypting..." : "Fetch, decrypt, and download"}
        </button>

        {status && <p className="mt-3 text-xs text-emerald-400">{status}</p>}
        {error && <p className="mt-3 text-xs text-rose-400">{error}</p>}
      </section>
    </main>
  );
}
