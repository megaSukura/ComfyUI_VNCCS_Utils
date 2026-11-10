import assert from "node:assert/strict";
import test from "node:test";
import { TRANSLATIONS, currentLocale, t } from "../web/i18n/index.mjs";
import { auditI18n, translationCalls } from "./helpers/i18n_audit.mjs";

function withLocale(locale, run) {
    const previous = globalThis.app;
    globalThis.app = { extensionManager: { setting: { get: id => (id === "Comfy.Locale" ? locale : undefined) } } };
    try {
        return run();
    } finally {
        globalThis.app = previous;
    }
}

test("t returns English text outside a Chinese ComfyUI and fills placeholders", () => {
    assert.equal(currentLocale(), "en");
    assert.equal(t("Reset Joint"), "Reset Joint");
    assert.equal(t("Delete {name}?", { name: "Pose 1" }), "Delete Pose 1?");
    assert.equal(t("{count} of {total}", { count: 2 }), "2 of {total}");
});

test("t follows the ComfyUI language setting", () => {
    TRANSLATIONS.zh["Test {count} poses"] = "测试 {count} 个姿势";
    TRANSLATIONS.zh["Test focus"] = "聚焦";
    TRANSLATIONS.zh["camera::Test focus"] = "对焦";
    try {
        assert.equal(withLocale("zh", () => t("Test {count} poses", { count: 3 })), "测试 3 个姿势");
        assert.equal(withLocale("zh-CN", currentLocale), "zh");
        assert.equal(withLocale("zh-TW", currentLocale), "en");
        assert.equal(withLocale("ja", () => t("Test {count} poses", { count: 3 })), "Test 3 poses");
        assert.equal(withLocale("zh", () => t("Untranslated text")), "Untranslated text");
        assert.equal(withLocale("zh", () => t("Test focus", null, "camera")), "对焦");
        assert.equal(withLocale("zh", () => t("Test focus", null, "timeline")), "聚焦");
        assert.equal(t("Test focus", null, "camera"), "Test focus");
    } finally {
        delete TRANSLATIONS.zh["Test {count} poses"];
        delete TRANSLATIONS.zh["Test focus"];
        delete TRANSLATIONS.zh["camera::Test focus"];
    }
});

test("translation calls are read with their JavaScript escapes", () => {
    const calls = translationCalls(`button.title = t("Don't stop"); label = t('It\\'s {name}', { name }); x = t(\`Line\\n\`);`);
    assert.deepEqual(calls.map(call => call.key), ["Don't stop", "It's {name}", "Line\n"]);
});

test("every t() key in the web sources has a Chinese translation with the same placeholders", () => {
    const report = auditI18n(["web"], TRANSLATIONS.zh);
    assert.deepEqual(report.invalid, []);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.mismatched, []);
});
