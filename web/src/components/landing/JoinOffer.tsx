import { Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { crossLinkCopy, headerCopy, landingCopy } from "../../lib/navigationCopy";
import { LINK_BUTTON, TEXT_LINK } from "../layout/styles";

interface Props {
  /**
   * After the last demo pack the offer takes the button's place, and focus
   * goes to its sentence, since the button it was on is gone (§7 "Landing demo").
   */
  takesFocus?: boolean;
}

/** `Playing needs an account…`, `Register` and `Already registered? Log in` (navigation-and-landing.md §3.7 item 4). */
export function JoinOffer({ takesFocus = false }: Props) {
  const focus = useCallback((node: HTMLParagraphElement | null) => node?.focus(), []);
  return (
    <>
      <p
        ref={takesFocus ? focus : undefined}
        tabIndex={takesFocus ? -1 : undefined}
        className="text-sm text-zinc-300 focus:outline-none"
      >
        {landingCopy.joinSentence}
      </p>
      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Link to="/register" className={LINK_BUTTON.primary}>
          {headerCopy.register}
        </Link>
        <p className="text-sm text-zinc-300">
          {crossLinkCopy.toLogIn}{" "}
          <Link to="/login" className={TEXT_LINK}>
            {headerCopy.logIn}
          </Link>
        </p>
      </div>
    </>
  );
}
