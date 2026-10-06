// Session persistence facade (contract: Auth section).
// Web: localStorage. Desktop (Tauri): OS keychain via IPC, so access tokens
// never sit in webview localStorage.

import type { SessionData } from "./types";

const PREFIX = "materix.account.";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// Generic small-secret storage (OS keychain on desktop, localStorage on web).
// Used for the crypto-store key record; caller owns the full key name.
export async function secretSet(key: string, value: string): Promise<void> {
  if (isTauri()) {
    await tauriInvoke("secret_set", { key, value });
    return;
  }
  localStorage.setItem(key, value);
}

export async function secretGet(key: string): Promise<string | null> {
  if (isTauri()) return tauriInvoke<string | null>("secret_get", { key });
  return localStorage.getItem(key);
}

export async function saveSession(key: string, data: SessionData): Promise<void> {
  await secretSet(PREFIX + key, JSON.stringify(data));
}

function parseSession(value: string | null): SessionData | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    for (const field of ["userId", "deviceId", "accessToken", "homeserverUrl"]) {
      if (typeof data[field] !== "string" || !data[field]) return null;
    }
    for (const field of ["refreshToken", "identityServerUrl"]) {
      if (data[field] !== undefined && typeof data[field] !== "string") return null;
    }
    return data as SessionData;
  } catch { return null; }
}

export async function loadSessions(): Promise<Map<string, SessionData>> {
  const out = new Map<string, SessionData>();
  if (isTauri()) {
    const keys = await tauriInvoke<string[]>("secret_list_keys");
    for (const key of keys) {
      if (!key.startsWith(PREFIX)) continue;
      const data = parseSession(await tauriInvoke<string | null>("secret_get", { key }));
      if (data) out.set(key.slice(PREFIX.length), data);
    }
    return out;
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const data = parseSession(localStorage.getItem(key));
    if (data) out.set(key.slice(PREFIX.length), data);
    // Preserve malformed records; a read must not destroy recovery material.
  }
  return out;
}

export async function deleteSession(key: string): Promise<void> {
  if (isTauri()) await tauriInvoke("secret_delete", { key: PREFIX + key });
  localStorage.removeItem(PREFIX + key);
}

/** Stable local account identifier per contract: sha256(userId|deviceId)[0..16]. */
export async function accountKeyFor(userId: string, deviceId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}|${deviceId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}
