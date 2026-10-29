import type { ReactNode } from "react";
import type { Notice } from "../hooks/useShell";
import { banners } from "../lib/copy";
import type { CopyText } from "../lib/loginText";
import { LoginText } from "./account/LoginText";
import { ALERT_BANNER, STATUS_BANNER } from "./account/styles";

/** What the frame shows around the main area: the live region text and the app-level notice (accounts.md §4.8). */
export interface Frame {
  announcement: CopyText;
  notice: Notice;
  retrying: boolean;
  onRetry: () => void;
}

interface Props {
  frame: Frame;
  /** The header's right side: view tabs and the Account control, or the signed-out Account button. */
  headerRight: ReactNode;
  children: ReactNode;
}

/** The page shell shared by the signed-out and signed-in views: title block, header right side, banners, footer. */
export function PageFrame({ frame, headerRight, children }: Props) {
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_rgb(76_29_149_/_0.25),_transparent_60%)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
              <span className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-sky-400 bg-clip-text text-transparent">
                Anime TCG
              </span>
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Open packs, collect characters. Data from{" "}
              <a
                href="https://anilist.co"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-200"
              >
                AniList
              </a>
              .
            </p>
          </div>
          {headerRight}
        </header>

        <p role="status" aria-live="polite" className="sr-only">
          <LoginText text={frame.announcement} />
        </p>

        {frame.notice === "unreachable" && (
          <div role="alert" className={ALERT_BANNER}>
            <span>{banners.unreachable}</span>
            <button
              type="button"
              onClick={frame.onRetry}
              disabled={frame.retrying}
              className="rounded-lg bg-red-800/60 px-3 py-1 font-medium hover:bg-red-700/60 disabled:opacity-50"
            >
              {banners.tryAgain}
            </button>
          </div>
        )}
        {frame.notice === "sessionEnded" && (
          <p role="status" className={STATUS_BANNER}>
            {banners.sessionEnded}
          </p>
        )}

        {children}

        <footer className="mt-8 text-center text-xs text-zinc-600">
          Non-commercial fan project. Character images and titles © their respective owners, served via the
          AniList API.
        </footer>
      </div>
    </div>
  );
}
