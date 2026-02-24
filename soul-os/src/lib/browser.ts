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

const DEFAULT_URL = "https://duckduckgo.com";

export async function toggleBrowser(): Promise<void> {
  if (browserOpen) {
    await closeBrowser();
  } else {
    await openUrl(lastUrl || DEFAULT_URL, fullMode);
  }
}

export async function toggleBrowserMode(): Promise<void> {
  fullMode = !fullMode;
  await invoke("open_browser", { url: lastUrl || DEFAULT_URL, fullMode });
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
