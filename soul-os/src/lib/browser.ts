import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

let lastUrl: string | null = null;
let fullMode = false;
let browserOpen = false;

export async function openUrl(url: string, full = false): Promise<void> {
  lastUrl = url;
  fullMode = full;
  browserOpen = true;
  await invoke("open_browser", { url, fullMode: full });
}

export async function closeBrowser(): Promise<void> {
  browserOpen = false;
  try {
    await invoke("close_browser");
  } catch {
    // window already closed
  }
}

export async function toggleBrowser(): Promise<void> {
  if (browserOpen && lastUrl) {
    await closeBrowser();
  } else if (lastUrl) {
    await openUrl(lastUrl, fullMode);
  }
}

export async function toggleBrowserMode(): Promise<void> {
  if (!lastUrl) return;
  fullMode = !fullMode;
  await invoke("open_browser", { url: lastUrl, fullMode });
}

export function getLastUrl(): string | null {
  return lastUrl;
}

export function isBrowserOpen(): boolean {
  return browserOpen;
}

export function isFullMode(): boolean {
  return fullMode;
}

export function onBrowserOpenUrl(handler: (url: string) => void): Promise<UnlistenFn> {
  return listen<string>("browser:open-url", (e) => handler(e.payload));
}
