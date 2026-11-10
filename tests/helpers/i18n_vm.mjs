// Widget sources that tests slice into vm contexts call `t` as a free identifier,
// like the real modules that import it from web/i18n/index.mjs. Importing this
// helper gives every new vm context that identifier unless the test provides one.
import { syncBuiltinESMExports } from "node:module";
import vm from "node:vm";
import { t } from "../../web/i18n/index.mjs";

const { createContext, runInNewContext } = vm;
const withTranslation = (context = {}) => {
    // Modules that already use `t` as a local name import the helper as `tr`.
    if (!("t" in context)) context.t = t;
    if (!("tr" in context)) context.tr = t;
    return context;
};
vm.createContext = (context, options) => createContext(withTranslation(context), options);
vm.runInNewContext = (code, context, options) => runInNewContext(code, withTranslation(context), options);
syncBuiltinESMExports();
