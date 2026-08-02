import { useState, type FormEvent } from "react";
import {
  AlertCircle,
  Box,
  Check,
  CheckCircle2,
  ChevronRight,
  Frame,
  GitBranch,
  MapPin,
  Route,
  Search,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react";

import type { WriteNoteInput } from "@topo/schema";

import {
  NOTE_COMPOSER_PRESETS,
  buildNoteComposerInput,
  createNoteComposerDraft,
  getNoteComposerPreset,
  type NoteComposerContext,
  type NoteComposerPreset,
  type NoteComposerPresetId,
} from "../note-composer";
import type { StudioNote } from "../studio-model";

export interface AnnotatePopoverProps {
  context: NoteComposerContext;
  onClose: () => void;
  onCreate: (input: WriteNoteInput) => Promise<StudioNote | undefined>;
}

const iconByPreset: Record<NoteComposerPresetId, LucideIcon> = {
  "element-pin": MapPin,
  "screen-note": Frame,
  "region-note": Box,
  "flow-note": Route,
  checklist: CheckCircle2,
  decision: AlertCircle,
  "canvas-note": StickyNote,
  "flow-marker": GitBranch,
};

export function AnnotatePopover({
  context,
  onClose,
  onCreate,
}: AnnotatePopoverProps) {
  const [draft, setDraft] = useState<
    ReturnType<typeof createNoteComposerDraft> | undefined
  >();
  const [submitting, setSubmitting] = useState(false);
  const [composerError, setComposerError] = useState<string>();
  const render = (items: readonly NoteComposerPreset[]) =>
    items.map((preset) => {
      const Icon = iconByPreset[preset.id];
      return (
        <button
          className={preset.id === "element-pin" ? "is-selected" : ""}
          data-note-preset={preset.id}
          key={preset.id}
          onClick={() => {
            setComposerError(undefined);
            setDraft(createNoteComposerDraft(preset.id, context));
          }}
          type="button"
        >
          <Icon size={17} />
          <span>{preset.label}</span>
        </button>
      );
    });

  if (draft) {
    const preset = getNoteComposerPreset(draft.presetId);
    const Icon = iconByPreset[draft.presetId];
    const submit = async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setComposerError(undefined);
      try {
        const input = buildNoteComposerInput(draft);
        setSubmitting(true);
        const created = await onCreate(input);
        if (!created) setComposerError("The note could not be saved.");
      } catch (error) {
        setComposerError(
          error instanceof Error
            ? error.message
            : "The note could not be saved.",
        );
      } finally {
        setSubmitting(false);
      }
    };
    return (
      <form
        aria-label={`Compose ${preset.label}`}
        className="annotate-popover annotate-composer"
        data-note-preset={draft.presetId}
        data-target-kind={draft.target.targetKind ?? "unbound"}
        onSubmit={(event) => void submit(event)}
      >
        <header className="annotate-composer-header">
          <button
            aria-label="Choose a different note type"
            className="annotate-back"
            onClick={() => {
              setComposerError(undefined);
              setDraft(undefined);
            }}
            type="button"
          >
            <ChevronRight size={14} />
          </button>
          <span className="annotate-composer-icon">
            <Icon size={17} />
          </span>
          <span>
            <strong>{preset.label}</strong>
            <small>Markdown note · {preset.noteType}</small>
          </span>
          <button
            aria-label="Close annotation composer"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </header>

        <label className="annotate-field">
          <span>TITLE</span>
          <input
            autoFocus
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, title: event.target.value } : current,
              )
            }
            placeholder="What should change?"
            value={draft.title}
          />
        </label>

        <label className="annotate-field">
          <span>NOTE</span>
          <textarea
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, body: event.target.value } : current,
              )
            }
            placeholder="Add context, acceptance criteria, or a Markdown checklist…"
            rows={4}
            value={draft.body}
          />
        </label>

        <section
          className="annotate-target"
          data-bound={Boolean(draft.target.targetId)}
        >
          <MapPin size={14} />
          <span>
            <small>
              {draft.target.targetKind
                ? draft.target.targetKind.replace("-", " ").toUpperCase()
                : "NO DURABLE TARGET"}
            </small>
            <strong>{draft.target.label}</strong>
            <em>{draft.target.evidence}</em>
          </span>
        </section>

        {composerError && (
          <p className="annotate-error" role="alert">
            <AlertCircle size={13} /> {composerError}
          </p>
        )}

        <footer className="annotate-actions">
          <button onClick={onClose} type="button">
            Cancel
          </button>
          <button disabled={submitting || !draft.title.trim()} type="submit">
            {submitting ? "Saving…" : "Create note"}
            {!submitting && <Check size={13} />}
          </button>
        </footer>
      </form>
    );
  }

  const anchored = NOTE_COMPOSER_PRESETS.filter(
    (preset) => preset.group === "anchored",
  );
  const free = NOTE_COMPOSER_PRESETS.filter(
    (preset) => preset.group === "free-standing",
  );
  return (
    <div
      aria-label="Choose a note type"
      className="annotate-popover"
      role="dialog"
    >
      <div className="annotate-search">
        <Search size={14} /> Add a note or marker
      </div>
      <span className="section-label">ANCHORED NOTES</span>
      <div className="annotate-grid">{render(anchored)}</div>
      <span className="section-label">FREE-STANDING</span>
      <div className="annotate-grid">{render(free)}</div>
    </div>
  );
}
