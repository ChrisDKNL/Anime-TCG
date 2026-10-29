import { Fragment } from "react";
import { textAroundLogin, type CopyText } from "../../lib/loginText";

/** Renders copy as text, with every embedded login isolated in <bdi> (T1, docs/05-security.md). */
export function LoginText({ text }: { text: CopyText }) {
  if (typeof text === "string") return text;
  return textAroundLogin(text.template).map((part, index) => (
    // The parts never reorder, so their position is a stable key.
    <Fragment key={index}>
      {index > 0 && <bdi>{text.login}</bdi>}
      {part}
    </Fragment>
  ));
}
