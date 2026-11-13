/**
 * TUI entry import probe for the Node build smoke.
 *
 * Imports both TUI entrypoints without rendering so Node verifies that the
 * Bun-only `@opentui/react/runtime-plugin-support` module is never executed.
 */
import "@atom-neo/tui";
import "@atom-neo/config-tui";

console.log("TUI_IMPORT_OK");
