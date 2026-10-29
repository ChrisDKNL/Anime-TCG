import { Fragment, type ComponentPropsWithoutRef } from "react";
import type { Announcement } from "../hooks/useShell";
import { LoginText } from "./account/LoginText";

interface Props extends Omit<ComponentPropsWithoutRef<"p">, "role" | "aria-live" | "children"> {
  announcement: Announcement;
}

/**
 * The single app-level `role="status"` region (accounts.md §7 "Live region").
 * It must stay mounted for the app's lifetime: screen readers often skip a
 * region that is inserted with its message already in it, so the text has to
 * arrive in a node that was already there. Inside it, each announcement is
 * keyed by its number, so a repeated message replaces the text nodes instead
 * of leaving the DOM unchanged.
 */
export function LiveRegion({ announcement, className = "sr-only", ...attributes }: Props) {
  return (
    <p {...attributes} role="status" aria-live="polite" className={className}>
      <Fragment key={announcement.id}>
        <LoginText text={announcement.text} />
      </Fragment>
    </p>
  );
}
