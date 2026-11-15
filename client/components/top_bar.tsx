import type { ComponentChildren, FunctionalComponent } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Notification } from "@silverbulletmd/silverbullet/type/client";
import { Input } from "@silverbulletmd/silverbullet/ui";
import {
  denoteIdentifierToDate,
  parseDenoteName,
} from "@silverbulletmd/silverbullet/lib/denote";

/**
 * Stepping through the journal, when the page being read is one of its
 * entries. A journal is read a day at a time, back and forth, and an entry's
 * title is its date -- so the two arrows belong either side of the name,
 * where they turn a page, rather than as two more icons in the toolbar.
 */
export type JournalNav = {
  previous: () => void;
  next: () => void;
};

export type ActionButton = {
  icon: FunctionalComponent<any>;
  description: string;
  class?: string;
  callback: () => void;
  href?: string;
  mobile?: boolean;
  dropdown?: boolean;
};

function pageNameClass(
  isLoading: boolean,
  unsavedChanges: boolean,
  cssClass?: string,
): string {
  const state = isLoading
    ? "sb-loading"
    : unsavedChanges
      ? "sb-unsaved"
      : "sb-saved";
  return cssClass ? `${state} sb-decorated-object ${cssClass}` : state;
}

function NotificationPanel({
  notifications,
  onDismiss,
}: {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}) {
  if (notifications.length === 0) return null;
  return createPortal(
    <div className="sb-notifications">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`sb-notification-${notification.type}`}
        >
          <span className="sb-notification-message">
            {notification.message}
          </span>
          {notification.actions && notification.actions.length > 0 && (
            <span className="sb-notification-actions">
              {notification.actions.map((action, i) => (
                <button
                  key={i}
                  className="sb-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    action.run();
                  }}
                >
                  {action.name}
                </button>
              ))}
            </span>
          )}
          {notification.persistent && (
            <button
              className="sb-notification-dismiss"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss(notification.id);
              }}
            >
              &times;
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

function SyncProgressIndicator({
  percentage,
  type,
  withLabel,
}: {
  percentage?: number;
  type?: string;
  withLabel?: boolean;
}) {
  if (percentage === undefined) return null;
  return (
    <div className="sb-sync-progress">
      <div
        className="progress-wrapper"
        title={`${type} progress: ${percentage}%`}
      >
        {withLabel && (
          <span className="progress-label">
            {type === "sync" ? "Syncing space" : "Indexing"}
          </span>
        )}
        <div className="progress-bar">
          <div
            className="progress-ring"
            style={`background: conic-gradient(var(--progress-${type}-color) ${percentage}%, var(--progress-background-color) 0);`}
          />
          <div className="progress-hole">{percentage}</div>
        </div>
      </div>
    </div>
  );
}

function ActionButtons({
  buttons,
  mobileMenuStyle,
}: {
  buttons: ActionButton[];
  mobileMenuStyle?: string;
}) {
  return (
    <div className={`sb-actions ${mobileMenuStyle ?? ""}`}>
      {buttons.map((actionButton) => {
        const btn = (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              actionButton.callback();
            }}
            onBlur={() => {
              if (mobileMenuStyle === "hamburger") {
                document
                  .querySelector("#sb-top .sb-actions.hamburger")
                  ?.classList.remove("open");
              }
            }}
            title={actionButton.description}
            className={actionButton.class}
          >
            <actionButton.icon size={18} />
          </button>
        );
        return actionButton.href ? (
          <a href={actionButton.href} key={actionButton.href}>
            {btn}
          </a>
        ) : (
          btn
        );
      })}
    </div>
  );
}

/**
 * A Denote name shown as what it means rather than what it says.
 *
 * A file name carries four things -- identifier, signature, title, keywords --
 * run together with `==`, `--` and `__` so that a plain-text library stays
 * sortable and greppable. That is the right trade on disk and the wrong one in
 * a title bar, where there is room to lay them out.
 *
 * The identifier sits last and quiet: it is the note's identity, not its
 * label, and its date is already the most useful thing about it.
 *
 * Only the title is read, so only the title gets the room. The signature
 * holds the left -- it is the note's address, a handful of characters, and a
 * clipped address is no address -- and the date holds the right. Between them
 * the keywords are the one negotiable thing, and they give way to the title
 * one at a time: `row-reverse` plus wrapping inside a one-line-tall box means
 * a pill that no longer fits is pushed onto a second line and clipped away
 * whole, instead of every pill being shaved at once.
 */
function DenoteName({
  pageName,
  journalNav,
}: {
  pageName: string;
  journalNav?: JournalNav;
}) {
  const parsed = parseDenoteName(pageName);
  if (!parsed?.identifier) {
    return null;
  }
  const title = parsed.title
    ? parsed.title.replaceAll("-", " ")
    : parsed.identifier;
  const date = denoteIdentifierToDate(parsed.identifier);
  return (
    <span className="sb-denote-name">
      {journalNav && (
        <button
          type="button"
          className="sb-dn-journal"
          title="Earlier journal entry"
          aria-label="Earlier journal entry"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            journalNav.previous();
          }}
        >
          &lsaquo;
        </button>
      )}
      {/*
        The file name itself is on the input underneath, which is what anything
        reading this bar should read; this is its presentation.
      */}
      <span className="sb-dn-parts" aria-hidden="true">
        {parsed.signature && (
          <span className="sb-dn-signature">{parsed.signature}</span>
        )}
        <span className="sb-dn-main">
          <span className="sb-dn-title">{title}</span>
          {/*
        Laid out right to left, so the row is eaten from its far end and the
        keywords nearest the title are the first to go. Reversed here to
        cancel that out: on screen they read in the order the file names them.
      */}
          <span className="sb-dn-keywords">
            {parsed.keywords
              .slice()
              .reverse()
              .map((keyword) => (
                <span className="sb-dn-keyword" key={keyword}>
                  {keyword}
                </span>
              ))}
          </span>
        </span>
        <span className="sb-dn-identifier" title={pageName}>
          {date
            ? date.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : parsed.identifier}
        </span>
      </span>
      {journalNav && (
        <button
          type="button"
          className="sb-dn-journal"
          title="Later journal entry"
          aria-label="Later journal entry"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            journalNav.next();
          }}
        >
          &rsaquo;
        </button>
      )}
    </span>
  );
}

function PageNameEditor({
  pageName,
  readOnly,
  onRename,
  journalNav,
}: {
  pageName?: string;
  readOnly: boolean;
  onRename: (newName?: string) => Promise<void>;
  journalNav?: JournalNav;
}) {
  const [name, setName] = useState(pageName ?? "");
  // The formatted name is a display; the input underneath stays the one
  // editable thing, so renaming is still renaming the file and nothing had to
  // learn a second way to do it.
  const [editing, setEditing] = useState(false);
  // Guards against the blur that fires when a successful rename refocuses the
  // editor, which would otherwise trigger a second (same-name) commit.
  const committing = useRef(false);
  // Re-sync when navigating to a different page.
  useEffect(() => setName(pageName ?? ""), [pageName]);

  const commit = (newName: string) => {
    if (committing.current) {
      return;
    }
    if (newName !== pageName) {
      committing.current = true;
      // On failure, restore the previous name
      Promise.resolve(onRename(newName))
        .catch(() => setName(pageName ?? ""))
        .finally(() => {
          committing.current = false;
        });
    } else {
      void onRename();
    }
  };

  const formatted =
    !editing && name === pageName ? (
      <DenoteName pageName={name} journalNav={journalNav} />
    ) : null;

  return (
    <span
      className={`sb-page-name${formatted ? " sb-page-name-formatted" : ""}`}
    >
      {formatted}
      <Input
        class="sb-page-name-editor"
        value={name}
        readOnly={readOnly}
        onInput={(e) => setName(e.currentTarget.value)}
        onConfirm={(value) => commit(value)}
        onFocus={() => setEditing(true)}
        onBlur={(e) => {
          setEditing(false);
          commit(e.currentTarget.value);
        }}
      />
    </span>
  );
}

export function TopBar({
  pageName,
  unsavedChanges,
  isOnline,
  isLoading,
  notifications,
  onRename,
  onDismissNotification,
  actionButtons,
  progressPercentage,
  progressType,
  progressWithLabel,
  lhs,
  rhs,
  pageNamePrefix,
  cssClass,
  mobileMenuStyle,
  readOnly,
  journalNav,
}: {
  pageName?: string;
  unsavedChanges: boolean;
  isOnline: boolean;
  isLoading: boolean;
  notifications: Notification[];
  progressPercentage?: number;
  progressType?: string;
  progressWithLabel?: boolean;
  onRename: (newName?: string) => Promise<void>;
  onDismissNotification: (id: number) => void;
  actionButtons: ActionButton[];
  lhs?: ComponentChildren;
  rhs?: ComponentChildren;
  pageNamePrefix?: string;
  cssClass?: string;
  mobileMenuStyle?: string;
  readOnly: boolean;
  journalNav?: JournalNav;
}) {
  return (
    <div id="sb-top" className={isOnline ? undefined : "sb-sync-error"}>
      {lhs}
      <div className="main">
        <div className="inner">
          <div className="wrapper">
            <div className="sb-page-prefix">{pageNamePrefix}</div>
            <span
              id="sb-current-page"
              className={pageNameClass(isLoading, unsavedChanges, cssClass)}
            >
              <PageNameEditor
                pageName={pageName}
                readOnly={readOnly}
                onRename={onRename}
                journalNav={journalNav}
              />
            </span>
            <NotificationPanel
              notifications={notifications}
              onDismiss={onDismissNotification}
            />
            <SyncProgressIndicator
              percentage={progressPercentage}
              type={progressType}
              withLabel={progressWithLabel}
            />
            {mobileMenuStyle ? (
              <>
                <ActionButtons
                  buttons={actionButtons.filter((b) => b.dropdown === false)}
                />
                <ActionButtons
                  buttons={actionButtons.filter((b) => b.dropdown !== false)}
                  mobileMenuStyle={mobileMenuStyle}
                />
              </>
            ) : (
              <ActionButtons buttons={actionButtons} />
            )}
          </div>
        </div>
      </div>
      {rhs}
    </div>
  );
}
