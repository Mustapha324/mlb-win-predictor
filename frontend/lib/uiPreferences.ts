"use client";

import { useSyncExternalStore } from "react";

export type UiPreferences = {
  largerText: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  liveRefresh: boolean;
};

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  largerText: false,
  highContrast: false,
  reduceMotion: false,
  liveRefresh: true
};

const STORAGE_KEY = "sport-iq-ui-preferences-v1";
const EVENT_NAME = "sport-iq:preferences";
let cachedRaw: string | null | undefined;
let cachedPreferences = DEFAULT_UI_PREFERENCES;

function parsePreferences(raw: string | null): UiPreferences {
  if (!raw) return DEFAULT_UI_PREFERENCES;
  try {
    const stored = JSON.parse(raw) as Partial<UiPreferences>;
    return {
      largerText: stored.largerText === true,
      highContrast: stored.highContrast === true,
      reduceMotion: stored.reduceMotion === true,
      liveRefresh: stored.liveRefresh !== false
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
}

function getSnapshot(): UiPreferences {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPreferences = parsePreferences(raw);
  }
  return cachedPreferences;
}

function subscribe(onChange: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(EVENT_NAME, onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(EVENT_NAME, onChange);
  };
}

export function useUiPreferences(): UiPreferences {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_UI_PREFERENCES);
}

export function saveUiPreferences(preferences: UiPreferences): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  cachedRaw = undefined;
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function resetUiPreferences(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  cachedRaw = undefined;
  window.dispatchEvent(new Event(EVENT_NAME));
}

export function applyUiPreferences(preferences: UiPreferences): void {
  const root = document.documentElement;
  root.dataset.fontSize = preferences.largerText ? "large" : "normal";
  root.dataset.contrast = preferences.highContrast ? "high" : "normal";
  root.dataset.reduceMotion = preferences.reduceMotion ? "true" : "false";
}
