import { t } from "../i18n/index.mjs";

export async function readPromptResponse(response) {
    try {
        const result = await response.json();
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(t("Invalid response object."));
        return result;
    } catch {
        const unavailable = response.status === 404 || response.status === 405;
        const error = new Error(unavailable
            ? t("Prompt Designer backend routes are unavailable (HTTP {status}). Check the ComfyUI startup log for API registration errors.", { status: response.status })
            : t("Invalid JSON response from Prompt Designer (HTTP {status}).", { status: response.status }));
        error.status = response.status;
        throw error;
    }
}
