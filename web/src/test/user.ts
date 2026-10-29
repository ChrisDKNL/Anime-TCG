import type { UserEvent } from "@testing-library/user-event";

/**
 * Fills a field the way pasting does: one input event instead of a keystroke and
 * re-render per character, which is what made the form tests slow. `user.type`
 * stays for tests where the keystrokes themselves are under test.
 */
export async function fill(user: UserEvent, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}
