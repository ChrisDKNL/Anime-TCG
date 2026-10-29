import { AVATAR } from "./styles";

const SIZE: Record<"sm" | "lg", string> = { sm: "size-7", lg: "size-10" };

/** The initial-letter placeholder (accounts.md §6); decorative, the login is always written next to it. */
export function Avatar({ login, size }: { login: string; size: "sm" | "lg" }) {
  const [initial = ""] = login;
  return (
    <span aria-hidden="true" className={`${AVATAR} ${SIZE[size]}`}>
      {initial}
    </span>
  );
}
