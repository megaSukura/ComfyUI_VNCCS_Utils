/**
 * Frontend translations for the VNCCS-Utils widgets.
 *
 * English source strings are the keys: `t("Reset Joint")` returns the
 * translation for the ComfyUI language (Settings > Comfy > Locale) or the
 * English text itself. `{name}` placeholders are filled from `params`.
 * When one English word needs different translations in different widgets,
 * pass a `context`; a `"context::Text"` entry then takes precedence.
 * The language is read when a string is rendered, so a language change shows
 * after the widget is rebuilt (reload the page).
 */

import factory3d from "./zh/factory3d.mjs";
import factory3dModules from "./zh/factory3d_modules.mjs";
import misc from "./zh/misc.mjs";
import poseStudio from "./zh/pose_studio.mjs";
import poseStudioModules from "./zh/pose_studio_modules.mjs";
import promptDesigner from "./zh/prompt_designer.mjs";
import uniCanvas from "./zh/unicanvas.mjs";
import uniCanvasModules from "./zh/unicanvas_modules.mjs";

export const TRANSLATIONS = {
    zh: {
        ...misc,
        ...promptDesigner,
        ...poseStudioModules,
        ...poseStudio,
        ...uniCanvasModules,
        ...uniCanvas,
        ...factory3dModules,
        ...factory3d,
    },
};

export function currentLocale() {
    // ComfyUI publishes its app on window; Node tests and early module loading have none.
    const app = globalThis.app;
    const store = app?.extensionManager?.setting;
    const locale = typeof store?.get === "function"
        ? store.get("Comfy.Locale")
        : app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return /^zh(-(CN|SG|Hans))?$/i.test(String(locale || "")) ? "zh" : "en";
}

export function t(text, params = null, context = null) {
    const dictionary = TRANSLATIONS[currentLocale()];
    const translated = (context ? dictionary?.[`${context}::${text}`] : undefined) ?? dictionary?.[text] ?? text;
    if (!params) return translated;
    return translated.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}
