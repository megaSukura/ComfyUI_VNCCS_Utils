// Checks `t("...")` usage in web sources against the translation dictionaries.
//
//   node tests/helpers/i18n_audit.mjs web/vnccs_unicanvas.js web/unicanvas
//
// prints keys without a Chinese translation, invalid keys, and hints: lines that
// still put an English literal into a visible DOM property without `t()`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SKIPPED_DIRECTORIES = new Set(["vendor", "i18n"]);
const PLACEHOLDER = /\{(\w+)\}/g;

const CALL = /(?<![\w$.])t\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*([,)])/g;
const HINTS = [
    /\b(?:textContent|innerText|title|placeholder|ariaLabel|alt)\s*=\s*(["'`])(?=[^"'`]*[A-Za-z]{2})(?:\\.|(?!\1)[^\\])*\1/,
    /setAttribute\(\s*["'](?:title|aria-label|placeholder|alt)["']\s*,\s*(["'`])(?=[^"'`]*[A-Za-z]{2})/,
    /\b(?:alert|confirm|prompt|showMessage|setStatus|showToast|flash)\(\s*(["'`])(?=[^"'`]*[A-Za-z]{2})/,
    /\b(?:label|title|tooltip|placeholder|description|text|message|hint)\s*:\s*(["'`])(?=[A-Z][^"'`]*[a-z])/,
    />\s*[A-Z][a-z]+(?:[\s,.'’!?-]+[A-Za-z]+)*[.:!?…]?\s*</,
];

export function unescapeLiteral(body) {
    return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (match, code) => {
        if (code[0] === "u") return String.fromCodePoint(parseInt(code.replace(/[u{}]/g, ""), 16));
        if (code[0] === "x" && code.length === 3) return String.fromCharCode(parseInt(code.slice(1), 16));
        return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }[code] ?? code;
    });
}

export function translationCalls(source) {
    const calls = [];
    for (const match of source.matchAll(CALL)) {
        const line = source.slice(0, match.index).split("\n").length;
        calls.push({ line, quote: match[1], key: unescapeLiteral(match[2]) });
    }
    return calls;
}

export function placeholders(text) {
    return [...text.matchAll(PLACEHOLDER)].map(match => match[1]).sort();
}

export function listSources(targets) {
    const files = [];
    const visit = target => {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
            if (SKIPPED_DIRECTORIES.has(path.basename(target))) return;
            for (const entry of fs.readdirSync(target)) visit(path.join(target, entry));
        } else if (/\.m?js$/.test(target)) files.push(target);
    };
    for (const target of targets) visit(path.resolve(ROOT, target));
    return files;
}

export function auditI18n(targets, dictionary) {
    const missing = [], invalid = [], hints = [];
    for (const file of listSources(targets)) {
        const source = fs.readFileSync(file, "utf8");
        const relative = path.relative(ROOT, file).replaceAll("\\", "/");
        for (const call of translationCalls(source)) {
            if (call.quote === "`" && call.key.includes("${")) invalid.push({ file: relative, line: call.line, key: call.key, reason: "interpolated template key; use {name} placeholders" });
            else if (!call.key.trim()) invalid.push({ file: relative, line: call.line, key: call.key, reason: "empty key" });
            else if (!(call.key in dictionary)) missing.push({ file: relative, line: call.line, key: call.key });
        }
        source.split("\n").forEach((text, index) => {
            if (/console\.|\bt\(/.test(text)) return;
            if (HINTS.some(pattern => pattern.test(text))) hints.push({ file: relative, line: index + 1, text: text.trim().slice(0, 160) });
        });
    }
    const mismatched = Object.entries(dictionary)
        .filter(([key, value]) => typeof value !== "string" || !value.trim() || placeholders(key).join() !== placeholders(value).join())
        .map(([key, value]) => ({ key, value }));
    return { missing, invalid, mismatched, hints };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { TRANSLATIONS } = await import("../../web/i18n/index.mjs");
    const targets = process.argv.slice(2);
    const report = auditI18n(targets.length ? targets : ["web"], TRANSLATIONS.zh);
    for (const item of report.invalid) console.log(`INVALID ${item.file}:${item.line} ${JSON.stringify(item.key)} (${item.reason})`);
    for (const item of report.missing) console.log(`MISSING ${item.file}:${item.line} ${JSON.stringify(item.key)}`);
    for (const item of report.mismatched) console.log(`PLACEHOLDERS ${JSON.stringify(item.key)} -> ${JSON.stringify(item.value)}`);
    for (const item of report.hints) console.log(`HINT ${item.file}:${item.line} ${item.text}`);
    console.log(`${report.missing.length} missing, ${report.invalid.length} invalid, ${report.mismatched.length} placeholder mismatches, ${report.hints.length} hints`);
    process.exitCode = report.missing.length || report.invalid.length || report.mismatched.length ? 1 : 0;
}
