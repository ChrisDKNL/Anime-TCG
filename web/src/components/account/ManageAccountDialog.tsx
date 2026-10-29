import type { AccountPublic } from "@anime-tcg/shared/api";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useChangePasswordForm } from "../../hooks/useChangePasswordForm";
import { useDeleteForm } from "../../hooks/useDeleteForm";
import { useRenameForm } from "../../hooks/useRenameForm";
import { cardCount, common, manageCopy, metaLine } from "../../lib/copy";
import { Avatar } from "./Avatar";
import { FormBanner } from "./FormBanner";
import { PasswordField, TextField } from "./fields";
import { BODY_TEXT, BUTTON, HINT_TEXT, PANEL_HEADING, SECTION_HEADING } from "./styles";

type Panel = "sections" | "confirmDelete";

interface Props {
  open: boolean;
  account: AccountPublic;
  onClose: () => void;
  onRenamed: (account: AccountPublic) => void;
  onDeleted: (login: string) => void;
}

/**
 * The Manage account dialog (accounts.md §3.5.3, §4.6): a native <dialog>
 * opened with showModal(), so the focus trap, Escape and background inertness
 * are the browser's. Its content mounts only while open, so every section
 * starts clean each time.
 */
export function ManageAccountDialog({ open, account, onClose, onRenamed, onDeleted }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<Panel>("sections");

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  /** Escape on the confirm panel goes back to the sections instead of closing (§4.6). */
  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    if (panel === "confirmDelete") {
      event.preventDefault();
      setPanel("sections");
    }
  };

  const handleClose = () => {
    setPanel("sections");
    onClose();
  };

  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-labelledby="manage-heading"
      aria-describedby={panel === "confirmDelete" ? "delete-body" : undefined}
      onCancel={handleCancel}
      onClose={handleClose}
      className="pop-in m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 backdrop:bg-zinc-950/70 backdrop:backdrop-blur-sm focus:outline-none"
    >
      {open && panel === "sections" && (
        <Sections
          account={account}
          onClose={() => ref.current?.close()}
          onRenamed={onRenamed}
          onDeleteRequested={() => setPanel("confirmDelete")}
        />
      )}
      {open && panel === "confirmDelete" && (
        <ConfirmDelete account={account} onCancel={() => setPanel("sections")} onDeleted={onDeleted} />
      )}
    </dialog>
  );
}

interface SectionsProps {
  account: AccountPublic;
  onClose: () => void;
  onRenamed: (account: AccountPublic) => void;
  onDeleteRequested: () => void;
}

function Sections({ account, onClose, onRenamed, onDeleteRequested }: SectionsProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <h2 id="manage-heading" className={PANEL_HEADING}>
          {manageCopy.heading}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={common.close}
          className={`${BUTTON.text} -mr-1 h-7`}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="size-5">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Avatar login={account.login} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-zinc-100" title={account.login}>
            {account.login}
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
        <h3 id="delete-section" className={SECTION_HEADING}>
          {manageCopy.deleteSection}
        </h3>
        <p className={BODY_TEXT}>{manageCopy.deleteExplanation}</p>
        <button type="button" onClick={onDeleteRequested} className={`${BUTTON.dangerOutline} self-start`}>
          {manageCopy.deleteTrigger}
        </button>
      </section>
    </div>
  );
}

function LoginSection({ login, onRenamed }: { login: string; onRenamed: (account: AccountPublic) => void }) {
  const form = useRenameForm({ login, onRenamed });
  return (
    <section
      aria-labelledby="login-section"
      className="mt-6 flex flex-col gap-3 border-t border-zinc-800 pt-6"
    >
      <h3 id="login-section" className={SECTION_HEADING}>
        {manageCopy.loginSection}
      </h3>
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
          <button
            type="submit"
            disabled={!form.changed || form.saving}
            className={`${BUTTON.primary} w-full sm:w-auto`}
          >
            {form.saving ? manageCopy.saving : manageCopy.save}
          </button>
        </div>
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
      <h3 id="password-section" className={SECTION_HEADING}>
        {manageCopy.passwordSection}
      </h3>
      <form noValidate onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-3">
        {form.unreachable && <FormBanner />}
        <PasswordField
          id="manage-current"
          label={manageCopy.currentLabel}
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
          <button
            type="submit"
            disabled={form.submitting || form.waitRemaining !== null}
            className={`${BUTTON.primary} w-full sm:w-auto ${form.waitRemaining !== null ? "tabular-nums" : ""}`}
          >
            {submitLabel}
          </button>
          {form.changed && <p className={BODY_TEXT}>{manageCopy.passwordChanged}</p>}
        </div>
        {form.breather && (
          <p role="status" className={HINT_TEXT}>
            {common.breather}
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
  const label =
    form.waitRemaining !== null
      ? common.tryAgainIn(form.waitRemaining)
      : form.deleting
        ? manageCopy.deleting
        : manageCopy.deleteButton(account.login);
  return (
    <form noValidate onSubmit={(event) => void form.submit(event)} className="flex flex-col gap-4">
      <h2 id="manage-heading" className={`${PANEL_HEADING} break-words`}>
        {manageCopy.deleteHeading(account.login)}
      </h2>
      <p id="delete-body" className={`${BODY_TEXT} break-words`}>
        {manageCopy.deleteBody(account.login, cardCount(account.cards))}
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
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
        <button
          type="submit"
          disabled={form.password.length === 0 || form.deleting || waiting}
          className={`${BUTTON.dangerSolid} w-full break-words sm:w-auto ${waiting ? "tabular-nums" : ""}`}
        >
          {label}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={form.deleting}
          className={`${BUTTON.secondary} w-full sm:w-auto`}
        >
          {common.cancel}
        </button>
      </div>
      {form.breather && (
        <p role="status" className={HINT_TEXT}>
          {common.breather}
        </p>
      )}
    </form>
  );
}
