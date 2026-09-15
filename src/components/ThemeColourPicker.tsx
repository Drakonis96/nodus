import { useEffect, useRef, useState } from 'react';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

interface ThemeColourPickerProps {
  labelText: string;
  hexLabel: string;
  value: string;
  onChange: (value: string) => void;
}

/** A compact swatch popover with an exact hex field beside the native picker. */
export function ThemeColourPicker({ labelText, hexLabel, value, onChange }: ThemeColourPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const safeValue = HEX_COLOUR.test(value) ? value : '#000000';

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="theme-colour-picker">
      <button
        type="button"
        className="theme-colour-picker-trigger"
        style={{ backgroundColor: safeValue }}
        aria-label={labelText}
        aria-expanded={open}
        title={labelText}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <div className="theme-colour-picker-popover" role="dialog" aria-label={labelText}>
          <strong>{labelText}</strong>
          <div className="theme-colour-picker-controls">
            <input
              className="theme-colour-picker-native"
              type="color"
              value={safeValue}
              aria-label={labelText}
              onChange={(event) => onChange(event.target.value)}
            />
            <label className="theme-colour-picker-hex-label">
              <span>{hexLabel}</span>
              <input
                className="theme-colour-picker-hex-input"
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-label={`${labelText} - ${hexLabel}`}
                placeholder="#6366f1"
                inputMode="text"
                maxLength={7}
                spellCheck={false}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
