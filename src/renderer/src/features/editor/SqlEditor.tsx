interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
}

export function SqlEditor({ value, onChange, onRun }: SqlEditorProps) {
  return (
    <textarea
      className="sql-editor"
      aria-label="SQL 编辑器"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          onRun();
        }
      }}
    />
  );
}
