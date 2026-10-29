import { useMenu } from "../../hooks/useMenu";
import { useFocusTarget } from "../../hooks/useShell";
import { header } from "../../lib/copy";
import { Avatar } from "./Avatar";

const CONTROL =
  "inline-flex max-w-full items-center gap-2 rounded-xl bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-zinc-900";

const MENU_ITEM =
  "block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800 focus:bg-zinc-800 focus:outline-none";

interface SignedInProps {
  login: string;
  /** While a pack opens or the log-out call is in flight (§4.5). */
  disabled: boolean;
  onManage: () => void;
  onLogout: () => void;
}

/** The signed-in header control: avatar, login, chevron, and the two-item menu (accounts.md §3.5, §7). */
export function AccountControl({ login, disabled, onManage, onLogout }: SignedInProps) {
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
  useFocusTarget("accountControl", buttonRef);

  const pick = (action: () => void) => {
    close(false);
    action();
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
        className={CONTROL}
      >
        <Avatar login={login} size="sm" />
        <span className="max-w-[8rem] truncate sm:max-w-[10rem]" title={login}>
          {login}
        </span>
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
          <button
            ref={itemRef(0)}
            type="button"
            role="menuitem"
            tabIndex={activeIndex === 0 ? 0 : -1}
            onClick={() => pick(onManage)}
            className={MENU_ITEM}
          >
            {header.manage}
          </button>
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

/** The signed-out header control: a plain button that brings the Account screen back to its choice (§4.5). */
export function AccountButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={CONTROL}>
      {header.accountSignedOut}
    </button>
  );
}
