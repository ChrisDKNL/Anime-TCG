import type { ComponentPropsWithoutRef } from "react";
import type { CopyText } from "../lib/loginText";
import { LoginText } from "./account/LoginText";

interface Props extends Omit<ComponentPropsWithoutRef<"p">, "role" | "aria-live" | "children"> {
  announcement: CopyText;
}

/**
 * The single app-level `role="status"` region (accounts.md §7 "Live region").
 * It must stay mounted for the app's lifetime: screen readers often skip a
 * region that is inserted with its message already in it, so the text has to
 * arrive in a node that was already there.
 */
export function LiveRegion({ announcement, className = "sr-only", ...attributes }: Props) {
  return (
    <p {...attributes} role="status" aria-live="polite" className={className}>
      <LoginText text={announcement} />
    </p>
  );
}
