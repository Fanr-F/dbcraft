import { useEffect, useRef, useState } from 'react';
import { Editor, type EditorType } from '@revolist/react-datagrid';

const STATUS_OPTIONS = ['active', 'pending', 'blocked'];

function SelectStatusEditor({ val, save, close }: EditorType) {
  const [value, setValue] = useState(String(val ?? 'active'));
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => save?.(value);
  const cancel = () => close?.();

  return (
    <select
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      {STATUS_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function BooleanEditor({ val, save, close }: EditorType) {
  const [value, setValue] = useState(String(Boolean(val)));
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => save?.(value === 'true');
  const cancel = () => close?.();

  return (
    <select
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    >
      <option value="true">true</option>
      <option value="false">false</option>
    </select>
  );
}

function DateEditor({ val, save, close }: EditorType) {
  const [value, setValue] = useState(String(val ?? ''));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const commit = () => save?.(value);
  const cancel = () => close?.();

  return (
    <input
      ref={ref}
      type="date"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}

function NoteEditor({ val, save, close }: EditorType) {
  const [value, setValue] = useState(String(val ?? ''));
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => save?.(value);
  const cancel = () => close?.();

  return (
    <textarea
      ref={ref}
      value={value}
      style={{ width: 320, height: 120, resize: 'both' }}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
}

export const STATUS_EDITOR = 'spike-status-editor';
export const BOOLEAN_EDITOR = 'spike-boolean-editor';
export const DATE_EDITOR = 'spike-date-editor';
export const NOTE_EDITOR = 'spike-note-editor';

export const editors = {
  [STATUS_EDITOR]: Editor(SelectStatusEditor),
  [BOOLEAN_EDITOR]: Editor(BooleanEditor),
  [DATE_EDITOR]: Editor(DateEditor),
  [NOTE_EDITOR]: Editor(NoteEditor),
};
