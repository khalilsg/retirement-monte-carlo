// Stamps the build version into the footer. Kept out of the markup so index.html
// never has to be edited to ship a bump — src/version.js is the only place the
// string lives, which is what makes the pre-push hook's one-file diff meaningful.
import { el } from "../dom.js";
import { VERSION } from "../version.js";

export function initFooter() {
  el("app-version").textContent = VERSION;
}
