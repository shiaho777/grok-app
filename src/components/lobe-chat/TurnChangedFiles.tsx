/**
 * Expandable “changed files” strip under a finished assistant turn (#998).
 * Cards show +/− when known; expand reveals inline highlighted diff.
 */

import { memo, useCallback, useMemo, useState } from "react";
import type { Locale } from "@/i18n";
import { createT } from "@/i18n";
import { IconFileDiff } from "@/components/icons";
import type { SessionFileChange } from "@/lib/sessionChanges";
import {
  buildTurnChangedFileCards,
  splitTurnChangedFiles,
} from "@/lib/turnChangedFiles";
import { TurnFileDiffPreview } from "./TurnFileDiffPreview";

export const TurnChangedFiles = memo(function TurnChangedFiles({
  paths,
  locale,
  streaming,
  sessionChanges,
  projectPath,
  onOpenPath,
  onViewAll,
}: {
  paths: string[];
  locale: Locale;
  streaming?: boolean;
  sessionChanges?: SessionFileChange[];
  projectPath?: string | null;
  onOpenPath?: (path: string) => void;
  onViewAll?: () => void;
}) {
  const tr = useMemo(() => createT(locale), [locale]);
  const cards = useMemo(
    () =>
      buildTurnChangedFileCards(paths, sessionChanges ?? [], projectPath),
    [paths, sessionChanges, projectPath],
  );
  const { visible, hiddenCount } = useMemo(
    () => splitTurnChangedFiles(cards),
    [cards],
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  if (streaming) return null;
  if (!cards.length) return null;

  const canOpen = typeof onOpenPath === "function";
  const canViewAll = typeof onViewAll === "function";

  return (
    <div
      className="lobe-turn-changed"
      data-testid="turn-changed-files"
      role="group"
      aria-label={tr("chat.changedFiles.aria")}
    >
      <div className="lobe-turn-changed__head">
        <IconFileDiff size={14} className="lobe-turn-changed__icon" />
        <span className="lobe-turn-changed__title">
          {cards.length === 1
            ? tr("chat.editedFilesOne")
            : tr("chat.editedFiles", { n: String(cards.length) })}
        </span>
        {canViewAll ? (
          <button
            type="button"
            className="lobe-turn-changed__view-all"
            data-testid="turn-changed-view-all"
            onClick={() => onViewAll()}
          >
            {tr("chat.changedFiles.viewAll")}
          </button>
        ) : null}
      </div>
      <div className="lobe-turn-changed__cards">
        {visible.map((card) => {
          const isOpen = !!expanded[card.path];
          const hasDelta = card.added > 0 || card.removed > 0;
          const expandLabel = isOpen
            ? tr("chat.changedFiles.collapse", { name: card.name })
            : tr("chat.changedFiles.expand", { name: card.name });
          return (
            <div
              key={card.path}
              className={
                isOpen
                  ? "lobe-turn-changed__card lobe-turn-changed__card--open"
                  : "lobe-turn-changed__card"
              }
              data-testid="turn-changed-file"
              data-path={card.path}
            >
              <button
                type="button"
                className="lobe-turn-changed__card-head"
                title={card.path}
                aria-expanded={isOpen}
                aria-label={expandLabel}
                onClick={() => toggle(card.path)}
              >
                <span className="lobe-turn-changed__card-name">{card.name}</span>
                {hasDelta ? (
                  <span
                    className="lobe-turn-changed__delta"
                    aria-hidden
                  >
                    {tr("chat.changedFiles.delta", {
                      added: String(card.added),
                      removed: String(card.removed),
                    })}
                  </span>
                ) : null}
                <span className="lobe-turn-changed__chev" aria-hidden>
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {isOpen ? (
                <TurnFileDiffPreview
                  patch={card.patch}
                  locale={locale}
                  onOpenInReview={
                    canOpen ? () => onOpenPath(card.path) : undefined
                  }
                />
              ) : null}
            </div>
          );
        })}
        {hiddenCount > 0 && canViewAll ? (
          <button
            type="button"
            className="lobe-turn-changed__chip lobe-turn-changed__chip--more"
            data-testid="turn-changed-more"
            onClick={() => onViewAll()}
          >
            {tr("chat.changedFiles.more", { n: String(hiddenCount) })}
          </button>
        ) : hiddenCount > 0 ? (
          <span className="lobe-turn-changed__chip lobe-turn-changed__chip--static">
            {tr("chat.changedFiles.more", { n: String(hiddenCount) })}
          </span>
        ) : null}
      </div>
    </div>
  );
});
