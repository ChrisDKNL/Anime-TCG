/// <reference lib="dom" />
import type { Locator, Page } from "@playwright/test";

/**
 * A contrast audit in the page itself (docs/design/visual-identity.md §5.4): every visible piece of text,
 * its computed colour composited over every background and every group opacity behind it, against the
 * WCAG 2.x thresholds (4.5:1, or 3:1 for text of 24 px and up, or 18.66 px bold and up).
 *
 * Exempt, as WCAG 1.4.3 exempts them: text in a disabled control (`disabled`, `aria-disabled="true"`, a
 * disabled fieldset) and text that is not shown (`sr-only`, zero size, `visibility: hidden`). Text that
 * sits on a background image or gradient (the card face, which `card-and-rarity.md` §4.2 audits on its
 * own terms) cannot be measured from computed styles and is returned apart, never as a pass.
 */
export interface ContrastFailure {
  text: string;
  ratio: number;
  needs: number;
  color: string;
  background: string;
  fontSize: string;
  fontWeight: string;
  /** A short path to the element, to find it in a failure message. */
  where: string;
}

export interface ContrastReport {
  failures: ContrastFailure[];
  /** Pieces of text on a gradient or image: not measured here. */
  unmeasured: string[];
  /** How many pieces of text were measured, so an empty scan cannot pass as a clean one. */
  measured: number;
  /** Every measured piece of text with its painted colour and background, for rules beyond the ratio. */
  pairs: Array<{ text: string; color: string; background: string }>;
}

/** Audits the page, or only the subtree of `scope`, in its current state. */
export async function auditContrast(page: Page, scope?: Locator): Promise<ContrastReport> {
  const root = scope === undefined ? null : await scope.elementHandle();
  return page.evaluate((scopeRoot: Element | null) => {
    type Rgba = [number, number, number, number];

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    /** Any CSS colour (oklch, color-mix, rgb with alpha) to sRGB bytes and alpha, as the browser paints it. */
    const parse = (css: string): Rgba => {
      const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(css);
      if (m !== null)
        return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: Rgba, below: Rgba): Rgba => {
      const a = top[3];
      return [
        top[0] * a + below[0] * (1 - a),
        top[1] * a + below[1] * (1 - a),
        top[2] * a + below[2] * (1 - a),
        1,
      ];
    };
    const mix = (behind: Rgba, front: Rgba, opacity: number): Rgba => [
      behind[0] * (1 - opacity) + front[0] * opacity,
      behind[1] * (1 - opacity) + front[1] * opacity,
      behind[2] * (1 - opacity) + front[2] * opacity,
      1,
    ];
    const luminance = ([r, g, b]: Rgba) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const hex = ([r, g, b]: Rgba) =>
      `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

    /** The element's ancestors, outermost first, down to itself, crossing an open dialog's top layer. */
    const chainOf = (element: Element): Element[] => {
      const chain: Element[] = [];
      for (let node: Element | null = element; node !== null; node = node.parentElement) chain.unshift(node);
      return chain;
    };

    /**
     * Paints the chain from the canvas down and, when `ink` is given, the text on top. Group opacity is
     * applied as the browser does: the subtree is painted on its own, then blended with what lies behind.
     */
    const paint = (chain: Element[], from: number, behind: Rgba, ink: Rgba | null): Rgba | "image" => {
      let base = behind;
      for (let i = from; i < chain.length; i += 1) {
        const style = getComputedStyle(chain[i]);
        const opacity = Number(style.opacity);
        if (opacity < 1 && i !== from) {
          const front = paint(chain, i, base, ink);
          if (front === "image") return "image";
          return mix(base, front, opacity);
        }
        if (style.backgroundImage !== "none") return "image";
        // A modal dialog's ::backdrop sits over the page behind it: paint it before the dialog.
        if (chain[i] instanceof HTMLDialogElement && (chain[i] as HTMLDialogElement).matches(":modal")) {
          base = over(parse(getComputedStyle(chain[i], "::backdrop").backgroundColor), base);
        }
        base = over(parse(style.backgroundColor), base);
        if (opacity < 1 && i === from) {
          // The group's own layer: continue inside it; the caller blends it.
          continue;
        }
      }
      return ink === null ? base : over(ink, base);
    };

    const exempt = (element: Element) =>
      element.closest(
        'button:disabled, input:disabled, select:disabled, textarea:disabled, fieldset:disabled, [aria-disabled="true"]',
      ) !== null;
    const hidden = (element: Element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return true;
      const style = getComputedStyle(element);
      if (style.visibility !== "visible" || style.display === "contents")
        return style.visibility !== "visible";
      for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.display === "none" || Number(s.opacity) === 0) return true;
        if (s.clip === "rect(0px, 0px, 0px, 0px)" || s.clipPath === "inset(50%)") return true;
      }
      return false;
    };
    const describe = (element: Element) =>
      chainOf(element)
        .slice(-3)
        .map((node) => {
          const id = node.id === "" ? "" : `#${node.id}`;
          const role = node.getAttribute("role");
          return `${node.tagName.toLowerCase()}${id}${role === null ? "" : `[role=${role}]`}`;
        })
        .join(" > ");

    const failures: ContrastFailure[] = [];
    const unmeasured: string[] = [];
    const pairs: Array<{ text: string; color: string; background: string }> = [];
    let measured = 0;
    const page: Rgba = [255, 255, 255, 1];
    const measure = (element: Element, text: string, inkCss: string, styleOf: CSSStyleDeclaration) => {
      const chain = chainOf(element);
      const ink = parse(inkCss);
      const background = paint(chain, 0, page, null);
      const painted = paint(chain, 0, page, ink);
      if (background === "image" || painted === "image") {
        unmeasured.push(text);
        return;
      }
      measured += 1;
      const size = parseFloat(styleOf.fontSize);
      const weight = Number(styleOf.fontWeight);
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const needs = large ? 3 : 4.5;
      const value = ratio(painted, background);
      pairs.push({ text, color: hex(painted), background: hex(background) });
      if (value < needs - 0.005) {
        failures.push({
          text,
          ratio: Math.round(value * 100) / 100,
          needs,
          color: hex(painted),
          background: hex(background),
          fontSize: styleOf.fontSize,
          fontWeight: styleOf.fontWeight,
          where: describe(element),
        });
      }
    };

    const start = scopeRoot ?? document.body;
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      const element = node.parentElement;
      if (text === "" || element === null || seen.has(element)) continue;
      if (element.closest("script, style, noscript, template") !== null) continue;
      seen.add(element);
      if (hidden(element) || exempt(element)) continue;
      const style = getComputedStyle(element);
      measure(element, text.slice(0, 60), style.color, style);
    }
    // Placeholders are text a visitor reads (WCAG 1.4.3 does not exempt them).
    for (const field of Array.from(start.querySelectorAll("input[placeholder], textarea[placeholder]"))) {
      if (hidden(field) || exempt(field) || (field as HTMLInputElement).value !== "") continue;
      const placeholder = getComputedStyle(field, "::placeholder");
      measure(field, `placeholder: ${field.getAttribute("placeholder")}`, placeholder.color, placeholder);
    }
    return { failures, unmeasured, measured, pairs };
  }, root);
}
