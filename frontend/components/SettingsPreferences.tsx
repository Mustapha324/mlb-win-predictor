"use client";

import {
  resetUiPreferences,
  saveUiPreferences,
  useUiPreferences,
  type UiPreferences
} from "@/lib/uiPreferences";

type SettingKey = keyof UiPreferences;

const SETTINGS: Array<{ key: SettingKey; title: string; description: string }> = [
  { key: "largerText", title: "Larger text", description: "Increase the base type size across picks, results, and account pages." },
  { key: "highContrast", title: "Higher contrast", description: "Brighten muted text and borders for easier scanning." },
  { key: "reduceMotion", title: "Reduce motion", description: "Turn off decorative movement and shorten transitions." },
  { key: "liveRefresh", title: "Automatic live updates", description: "Refresh active games and player results every 30 seconds." }
];

export function SettingsPreferences() {
  const preferences = useUiPreferences();
  const update = (key: SettingKey, checked: boolean) => saveUiPreferences({ ...preferences, [key]: checked });
  return (
    <section className="sport-panel p-5 sm:p-7" aria-labelledby="accessibility-settings-heading">
      <p className="eyebrow">Display & live experience</p>
      <h2 id="accessibility-settings-heading" className="mt-2 text-2xl font-black text-white">Make Sport IQ work for you</h2>
      <div className="mt-5 divide-y divide-white/[0.08]">
        {SETTINGS.map((setting) => (
          <label key={setting.key} htmlFor={`setting-${setting.key}`} className="flex min-h-20 cursor-pointer items-center justify-between gap-5 py-4">
            <span>
              <span className="block text-sm font-black text-white">{setting.title}</span>
              <span className="mt-1 block max-w-xl text-xs leading-5 text-neutral-400">{setting.description}</span>
            </span>
            <span className="relative shrink-0">
              <input
                id={`setting-${setting.key}`}
                type="checkbox"
                role="switch"
                aria-label={setting.title}
                checked={preferences[setting.key]}
                onChange={(event) => update(setting.key, event.target.checked)}
                className="peer sr-only"
              />
              <span className="block h-7 w-12 rounded-full border border-white/15 bg-white/[0.08] transition peer-checked:border-lime-300/40 peer-checked:bg-lime-300/25 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-lime-300" />
              <span className="pointer-events-none absolute left-1 top-1 h-5 w-5 rounded-full bg-neutral-400 transition peer-checked:translate-x-5 peer-checked:bg-lime-200" />
            </span>
          </label>
        ))}
      </div>
      <button type="button" onClick={resetUiPreferences} className="secondary-button mt-5">Restore defaults</button>
    </section>
  );
}
