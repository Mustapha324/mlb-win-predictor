"use client";

import { useEffect } from "react";
import { applyUiPreferences, useUiPreferences } from "@/lib/uiPreferences";

export function PreferenceSync() {
  const preferences = useUiPreferences();
  useEffect(() => applyUiPreferences(preferences), [preferences]);
  return null;
}
