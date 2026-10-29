import { banners } from "../../lib/copy";

/** The in-form "nothing was changed" failure line (accounts.md §8 "unreachable-form"). */
export function FormBanner() {
  return (
    <p role="alert" className="rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm text-red-200">
      {banners.unreachableForm}
    </p>
  );
}
