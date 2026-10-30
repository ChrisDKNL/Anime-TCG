import type { AccountPublic } from "@anime-tcg/shared/api";
import { useLayoutEffect, useRef, useState } from "react";
import { useChangePasswordForm } from "../../hooks/useChangePasswordForm";
import { useDeleteForm } from "../../hooks/useDeleteForm";
import { useRenameForm } from "../../hooks/useRenameForm";
import { cardCount, common, manageCopy, metaLine } from "../../lib/copy";
import { pageHeading } from "../../lib/routes";
import { PageHeading } from "../layout/PageHeading";
import { Avatar } from "./Avatar";
import { FormBanner } from "./FormBanner";
import type { CopyText } from "../../lib/loginText";
import { LoginText } from "./LoginText";
import { PasswordField, SubmitButton, TextField } from "./fields";
import { BODY_TEXT, BUTTON, HINT_TEXT, PANEL_HEADING, SECTION_HEADING } from "./styles";

interface Props {
  account: AccountPublic;
  onRenamed: (account: AccountPublic) => void;
  onDeleted: (login: string) => void;
}

/**
 * The `/account` page's body (navigation-and-landing.md §3.4): the account
 * header and the Login, Password and Delete account sections of accounts.md
 * §3.5.3, now `h2`s under the page's `h1`. There is no Close: the page is left
 * like any other. `Delete account…` opens the confirmation as a modal dialog.
 */
export function ManageAccount({ account, onRenamed, onDeleted }: Props) {
  /**
   * Each press of `Delete account…` is a new opening with its own id, so a
   * press that lands before React has seen the previous close (Escape closes
   * the native dialog at once; the `close` event comes a task later) still
   * opens a fresh confirmation instead of finding `open` already true.
   */
  const [confirmation, setConfirmation] = useState({ open: false, id: 0 });
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  const openConfirm = () => setConfirmation(({ id }) => ({ open: true, id: id + 1 }));
  /** Cancel and Escape return focus to `Delete account…` (accounts.md §11). */
  const closeConfirm = () => {
    setConfirmation(({ id }) => ({ open: false, id }));
    deleteTriggerRef.current?.focus();
  };

  return (
    <div className="flex max-w-lg flex-col">
      <PageHeading text={pageHeading("/account")} />

      <div className="flex items-center gap-3">
        <Avatar login={account.login} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-zinc-100">
            <bdi title={account.login}>{account.login}</bdi>
          </p>
          <p className={HINT_TEXT}>{metaLine(account.cards, account.createdAt)}</p>
        </div>
      </div>

      <LoginSection login={account.login} onRenamed={onRenamed} />
      <PasswordSection />

      <section
        aria-labelledby="delete-section"
        className="mt-6 flex flex-col gap-3 border-t border-zinc-800 pt-6"
      >
        <h2 id="delete-section" className={SECTION_HEADING}>
          {manageCopy.deleteSection}
        </h2>
        <p className={BODY_TEXT}>{manageCopy.deleteExplanation}</p>
        <button
          ref={deleteTriggerRef}
          type="button"
          onClick={openConfirm}
          className={`${BUTTON.dangerOutline} self-start`}
        >
          {manageCopy.deleteTrigger}
        </button>
      </section>

      <DeleteDialog
        open={confirmation.open}
        openingId={confirmation.id}
        account={account}
        onClose={closeConfirm}
        onDeleted={onDeleted}
      />
    </div>
  );
}

interface DeleteDialogProps {
  open: boolean;
  /** Changes with every opening: the form remounts (empty, password focused) for each one. */
  openingId: number;
  account: AccountPublic;
  onClose: () => void;
  onDeleted: (login: string) => void;
}

/**
 * The delete confirmation as a native modal <dialog> (§3.4 step 3): showModal()
 * gives the focus trap, Escape and background inertness; the password field
 * takes focus as it opens (accounts.md §7 "Dialog"). Its form mounts only
 * while open, so the field starts empty every time.
 */
function DeleteDialog({ open, openingId, account, onClose, onDeleted }: DeleteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  // A layout effect, so the dialog is open before the form's own effect focuses its password field.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open, openingId]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="delete-heading"
      aria-describedby="delete-body"
      // A `close` event for an earlier opening can arrive after the dialog was opened again: ignore it.
      onClose={() => {
        if (ref.current?.open !== true) onClose();
      }}
      className="pop-in m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 backdrop:bg-zinc-950/70 backdrop:backdrop-blur-sm focus:outline-none"
    >
      {open && (
        <ConfirmDelete
          key={openingId}
          account={account}
          onCancel={() => ref.current?.close()}
          onDeleted={onDeleted}
        />
      )}
    </dialog>
  );
}

function LoginSection({ login, onRenamed }: { login: string; onRenamed: (account: AccountPublic) => void }) {
  const form = useRenameForm({ login, onRenamed });
  const waiting = form.waitRemaining !== null;
  const submitLabel =
    form.waitRemaining !== null
      ? common.tryAgainIn(form.waitRemaining)
      : form.saving
        ? manageCopy.saving
        : manageCopy.save;
  return (
    <section
      aria-labelledby="login-section"
      className="mt-6 flex flex-col gap-3 border-t border-zinc-800 pt-6"
    >
      <h2 id="login-section" className={SECTION_HEADING}>
        {manageCopy.loginSection}
      </h2>
      <form noValidate onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-3">
        {form.unreachable && <FormBanner />}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="flex-1">
            <TextField
              id="manage-login"
              label={manageCopy.newLoginLabel}
              labelHidden
              value={form.value}
              onChange={form.setValue}
              state={form.field}
              ref={form.fieldRef("login")}
              disabled={form.saving}
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={24}
            />
          </div>
          <SubmitButton
            blocked={!form.changed || form.saving || waiting}
            className={`${BUTTON.primary} w-full sm:w-auto ${waiting ? "tabular-nums" : ""}`}
          >
            {submitLabel}
          </SubmitButton>
        </div>
        {form.waitStatus !== null && (
          <p role="status" className={HINT_TEXT}>
            {form.waitStatus}
          </p>
        )}
      </form>
    </section>
  );
}

function PasswordSection() {
  const form = useChangePasswordForm();
  const submitLabel =
    form.waitRemaining !== null
      ? common.tryAgainIn(form.waitRemaining)
      : form.submitting
        ? manageCopy.changing
        : manageCopy.change;
  return (
    <section
      aria-labelledby="password-section"
      className="mt-6 flex flex-col gap-3 border-t border-zinc-800 pt-6"
    >
      <h2 id="password-section" className={SECTION_HEADING}>
        {manageCopy.passwordSection}
      </h2>
      <form noValidate onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-3">
        {form.unreachable && <FormBanner />}
        <PasswordField
          id="manage-current"
          label={manageCopy.currentLabel}
          toggle="current"
          value={form.values.current}
          onChange={(value) => form.setValue("current", value)}
          state={form.fields.current}
          ref={form.fieldRef("current")}
          disabled={form.submitting}
          autoComplete="current-password"
        />
        <PasswordField
          id="manage-next"
          label={manageCopy.newLabel}
          toggle="new"
          hint={common.passwordRules}
          value={form.values.next}
          onChange={(value) => form.setValue("next", value)}
          state={form.fields.next}
          ref={form.fieldRef("next")}
          disabled={form.submitting}
          autoComplete="new-password"
        />
        <PasswordField
          id="manage-confirm"
          label={manageCopy.confirmNewLabel}
          toggle="confirmation"
          value={form.values.confirm}
          onChange={(value) => form.setValue("confirm", value)}
          state={form.fields.confirm}
          ref={form.fieldRef("confirm")}
          disabled={form.submitting}
          autoComplete="new-password"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SubmitButton
            blocked={form.submitting || form.waitRemaining !== null}
            className={`${BUTTON.primary} w-full sm:w-auto ${form.waitRemaining !== null ? "tabular-nums" : ""}`}
          >
            {submitLabel}
          </SubmitButton>
          {form.changed && <p className={BODY_TEXT}>{manageCopy.passwordChanged}</p>}
        </div>
        {form.waitStatus !== null && (
          <p role="status" className={HINT_TEXT}>
            {form.waitStatus}
          </p>
        )}
      </form>
    </section>
  );
}

interface ConfirmDeleteProps {
  account: AccountPublic;
  onCancel: () => void;
  onDeleted: (login: string) => void;
}

function ConfirmDelete({ account, onCancel, onDeleted }: ConfirmDeleteProps) {
  const form = useDeleteForm({ onDeleted: () => onDeleted(account.login) });
  const waiting = form.waitRemaining !== null;
  const label: CopyText =
    form.waitRemaining !== null
      ? common.tryAgainIn(form.waitRemaining)
      : form.deleting
        ? manageCopy.deleting
        : { template: manageCopy.deleteButton, login: account.login };
  return (
    <form noValidate onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-4">
      <h2 id="delete-heading" className={`${PANEL_HEADING} break-words`}>
        <LoginText text={{ template: manageCopy.deleteHeading, login: account.login }} />
      </h2>
      <p id="delete-body" className={`${BODY_TEXT} break-words`}>
        <LoginText
          text={{
            template:
              account.cards === 0
                ? manageCopy.deleteBodyNoCards
                : (login) => manageCopy.deleteBody(login, cardCount(account.cards)),
            login: account.login,
          }}
        />
      </p>
      {form.unreachable && <FormBanner />}
      <PasswordField
        id="delete-password"
        label={manageCopy.deletePasswordLabel}
        value={form.password}
        onChange={form.setPassword}
        state={form.field}
        ref={form.fieldRef("password")}
        disabled={form.deleting}
        autoComplete="current-password"
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* An empty password keeps the real `disabled`: focus is in the field then, and Enter must do nothing (§7 "Dialog"). */}
        <SubmitButton
          blocked={form.deleting || waiting}
          disabled={form.password.length === 0}
          className={`${BUTTON.dangerSolid} w-full break-words sm:w-auto ${waiting ? "tabular-nums" : ""}`}
        >
          <LoginText text={label} />
        </SubmitButton>
        <button
          type="button"
          onClick={onCancel}
          disabled={form.deleting}
          className={`${BUTTON.secondary} w-full sm:w-auto`}
        >
          {common.cancel}
        </button>
      </div>
      {form.waitStatus !== null && (
        <p role="status" className={HINT_TEXT}>
          {form.waitStatus}
        </p>
      )}
    </form>
  );
}
