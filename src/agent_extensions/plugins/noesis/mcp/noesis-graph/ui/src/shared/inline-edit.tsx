import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconPencil, IconX } from "@tabler/icons-react";
import { Loader, Text, Tooltip } from "@mantine/core";

import classes from "./inline-edit.module.css";

type EditorMode = "text" | "textarea";

interface InlineEditProps {
  value: string;
  mode: EditorMode;
  onSave: (next: string) => Promise<void>;
  display: ReactNode;
  ariaLabel?: string;
  block?: boolean;
}

export function InlineEdit({
  value,
  mode,
  onSave,
  display,
  ariaLabel = "Edit",
  block = false,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current !== null) {
      inputRef.current.focus();
      if (mode === "text" && inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [editing, mode]);

  const start = (): void => {
    setDraft(value);
    setError(null);
    setEditing(true);
  };

  const cancel = (): void => {
    setEditing(false);
    setSaving(false);
    setError(null);
    setDraft(value);
  };

  const save = async (): Promise<void> => {
    if (saving) return;
    if (draft === value) {
      cancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter" && (mode === "text" || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  if (editing) {
    return (
      <div className={mode === "textarea" ? classes.editorBlock : classes.editorRow}>
        {mode === "text" ? (
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            className={classes.input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            aria-label={ariaLabel}
          />
        ) : (
          <textarea
            ref={(el) => {
              inputRef.current = el;
            }}
            className={classes.textarea}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            aria-label={ariaLabel}
            rows={6}
          />
        )}
        <div className={classes.actions}>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={classes.saveButton}
            aria-label="Save"
          >
            {saving ? <Loader size={12} color="noesisGreen" /> : <IconCheck size={14} stroke={2} />}
            <span>Save</span>
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className={classes.cancelButton}
            aria-label="Cancel"
          >
            <IconX size={14} stroke={2} />
            <span>Cancel</span>
          </button>
        </div>
        {error !== null && (
          <Text className={classes.errorText} size="xs">
            {error}
          </Text>
        )}
      </div>
    );
  }

  const wrapperClass = block ? classes.wrapperBlock : classes.wrapper;
  return (
    <span className={wrapperClass}>
      <span style={{ minWidth: 0, flex: block ? 1 : "0 1 auto" }}>{display}</span>
      <Tooltip label={ariaLabel} openDelay={300}>
        <button
          type="button"
          className={classes.editButton}
          onClick={start}
          aria-label={ariaLabel}
        >
          <IconPencil size={14} stroke={1.5} />
        </button>
      </Tooltip>
    </span>
  );
}
