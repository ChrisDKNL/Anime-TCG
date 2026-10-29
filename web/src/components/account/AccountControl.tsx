import { Link } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import { useCurrentPageClick } from "../../hooks/useCurrentPageClick";
import { useMenu } from "../../hooks/useMenu";
import { header } from "../../lib/copy";
import { Avatar } from "./Avatar";
import { ACCOUNT_CONTROL, MENU_ITEM } from "./styles";

interface Props {
  login: string;
  /** While a pack opens or the log-out call is in flight (§4.5). */
  disabled: boolean;
  onLogout: () => void;
}

/**
 * The signed-in header control: avatar, login, chevron, and the two-item menu
 * (accounts.md §3.5, §7). `Manage account` is a link to `/account`, marked as
 * the current page there (navigation-and-landing.md §3.4 step 1).
 */
export function AccountControl({ login, disabled, onLogout }: Props) {
  const {
    open,
    activeIndex,
    rootRef,
    buttonRef,
    itemRef,
    onButtonClick,
    onButtonKeyDown,
    onMenuKeyDown,
    close,
  } = useMenu(2);
  const manage = useCurrentPageClick("/account");

  const pick = (action: () => void) => {
    close(false);
    action();
  };

  /** Leaving for /account, the page change focuses its heading; already there, focus goes back to the button. */
  const pickManage = (event: MouseEvent<HTMLAnchorElement>) => {
    manage.onClick(event);
    close(event.defaultPrevented);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        id="account-menu-button"
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={header.accountMenuLabel(login)}
        onClick={onButtonClick}
        onKeyDown={onButtonKeyDown}
        className={ACCOUNT_CONTROL}
      >
        <Avatar login={login} size="sm" />
        <bdi className="max-w-[8rem] truncate sm:max-w-[10rem]" title={login}>
          {login}
        </bdi>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="size-4 shrink-0 text-zinc-400"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          id="account-menu"
          role="menu"
          aria-labelledby="account-menu-button"
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          className="pop-in absolute top-full right-0 z-10 mt-1 min-w-[12rem] rounded-xl border border-zinc-800 bg-zinc-900 p-1 shadow-xl shadow-black/40"
        >
          <Link
            ref={itemRef(0)}
            to="/account"
            role="menuitem"
            tabIndex={activeIndex === 0 ? 0 : -1}
            onClick={pickManage}
            activeOptions={{ exact: true, includeSearch: false }}
            activeProps={{}}
            className={MENU_ITEM}
          >
            {header.manage}
          </Link>
          <div role="separator" className="my-1 border-t border-zinc-800" />
          <button
            ref={itemRef(1)}
            type="button"
            role="menuitem"
            tabIndex={activeIndex === 1 ? 0 : -1}
            onClick={() => pick(onLogout)}
            className={MENU_ITEM}
          >
            {header.logOut}
          </button>
        </div>
      )}
    </div>
  );
}
