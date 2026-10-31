import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// The default 1 s for findBy* and waitFor fails tests on a loaded machine (CI, a parallel run).
configure({ asyncUtilTimeout: 5_000 });

/**
 * Everything below needs a DOM. A file that opts into `// @vitest-environment node` (the production build
 * test) runs this setup too, without one.
 */
const hasDom = typeof document !== "undefined";

afterEach(() => {
  if (!hasDom) return;
  cleanup();
  localStorage.clear();
});

if (hasDom) {
  // jsdom has the <dialog> element but not its modal API; the shim keeps the
  // `open` attribute and the `close` event in step so React's onClose fires.
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement, returnValue?: string) {
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }

  // jsdom does not lay out or scroll; the router's scroll restoration calls this on every page change,
  // and the collection's pages scroll the results line into view.
  window.scrollTo = () => undefined;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
