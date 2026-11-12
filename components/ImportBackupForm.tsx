"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ImportBackupForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function restore() {
    if (!file || busy) return;
    setMessage("");
    if (file.size > 10_000_000) {
      setMessage("Choose a JSON export smaller than 10 MB.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: await file.text(),
      });
      const result = (await response.json()) as {
        error?: string;
        courses?: number;
        notes?: number;
        roadmaps?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "Import failed.");
      setMessage(`Imported ${result.courses ?? 0} courses, ${result.notes ?? 0} notes and ${result.roadmaps ?? 0} roadmaps.`);
      setFile(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
    setBusy(false);
  }

  return (
    <div className="field">
      <label className="input-label" htmlFor="backup-file">Import a JSON export</label>
      <input
        id="backup-file"
        className="input"
        type="file"
        accept="application/json,.json"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <p className="field-hint">Adds a copy to this local profile. Keep your original export for recovery.</p>
      <button className="btn btn-outline btn-sm" type="button" disabled={!file || busy} onClick={restore}>
        {busy ? "Importing…" : "Import export"}
      </button>
      {message ? <p className="form-note" role="status">{message}</p> : null}
    </div>
  );
}
