export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

function normalizeKey(key: string): string {
  if (key === ' ') return 'Space';
  const trimmed = key.trim();
  if (/^space$/i.test(trimmed)) return 'Space';
  if (/^enter$/i.test(trimmed)) return 'Enter';
  if (/^esc(ape)?$/i.test(trimmed)) return 'Escape';
  if (/^tab$/i.test(trimmed)) return 'Tab';
  if (/^(arrow)?(up|down|left|right)$/i.test(trimmed)) {
    return `Arrow${trimmed.replace(/^arrow/i, '').toLowerCase().replace(/^./, (char) => char.toUpperCase())}`;
  }
  return trimmed.length === 1 ? trimmed.toUpperCase() : trimmed;
}

export function normalizeShortcut(accelerator: string): string {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = normalizeKey(parts.pop() ?? '');
  const modifiers = new Set(
    parts.map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'cmd' || lower === 'meta') return 'ctrl';
      return lower;
    }),
  );
  const order = ['ctrl', 'alt', 'shift'];
  return [
    ...order.filter((modifier) => modifiers.has(modifier)).map((modifier) => modifier[0]!.toUpperCase() + modifier.slice(1)),
    key,
  ].join('+');
}

export function matchesShortcut(event: ShortcutEvent, accelerator: string): boolean {
  const normalized = normalizeShortcut(accelerator);
  const parts = normalized.split('+');
  const key = normalizeKey(parts[parts.length - 1] ?? '');
  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));

  if (normalizeKey(event.key) !== key) return false;
  if (modifiers.has('ctrl') !== (event.ctrlKey || event.metaKey)) return false;
  if (modifiers.has('alt') !== event.altKey) return false;
  if (modifiers.has('shift') !== event.shiftKey) return false;
  return true;
}
