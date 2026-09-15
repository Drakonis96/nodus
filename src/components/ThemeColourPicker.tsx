import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

interface ThemeColourPickerProps {
  labelText: string;
  hexLabel: string;
  value: string;
  onChange: (value: string) => void;
}

interface HslColour {
  h: number;
  s: number;
  l: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function hexToHsl(hex: string): HslColour {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l: lightness * 100 };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (max === red) hue = 60 * (((green - blue) / delta) % 6);
  else if (max === green) hue = 60 * ((blue - red) / delta + 2);
  else hue = 60 * ((red - green) / delta + 4);
  return { h: hue < 0 ? hue + 360 : hue, s: saturation * 100, l: lightness * 100 };
}

function hslToHex({ h, s, l }: HslColour): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = h / 60;
  const second = chroma * (1 - Math.abs((hue % 2) - 1));
  const [red, green, blue] = hue < 1
    ? [chroma, second, 0]
    : hue < 2
      ? [second, chroma, 0]
      : hue < 3
        ? [0, chroma, second]
        : hue < 4
          ? [0, second, chroma]
          : hue < 5
            ? [second, 0, chroma]
            : [chroma, 0, second];
  const match = lightness - chroma / 2;
  const channel = (value: number) => Math.round((value + match) * 255).toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** A compact, dependency-free picker with a preview, hue control, and exact hex input. */
export function ThemeColourPicker({ labelText, hexLabel, value, onChange }: ThemeColourPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastValidValueRef = useRef(HEX_COLOUR.test(value) ? value.toLowerCase() : '#000000');
  const safeValue = HEX_COLOUR.test(value) ? value.toLowerCase() : lastValidValueRef.current;
  const hsl = hexToHsl(safeValue);

  useEffect(() => {
    if (HEX_COLOUR.test(value)) lastValidValueRef.current = value.toLowerCase();
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
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

  const updateFromPalette = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * 100;
    const lightness = (1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1)) * 100;
    onChange(hslToHex({ h: hsl.h, s: saturation, l: lightness }));
  };

  const adjustPalette = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    let saturation = hsl.s;
    let lightness = hsl.l;
    if (event.key === 'ArrowLeft') saturation -= step;
    else if (event.key === 'ArrowRight') saturation += step;
    else if (event.key === 'ArrowDown') lightness -= step;
    else if (event.key === 'ArrowUp') lightness += step;
    else return;
    event.preventDefault();
    onChange(hslToHex({ h: hsl.h, s: clamp(saturation, 0, 100), l: clamp(lightness, 0, 100) }));
  };

  return (
    <div ref={rootRef} className="theme-colour-picker">
      <button
        type="button"
        className="theme-colour-picker-trigger"
        aria-label={labelText}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={labelText}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="theme-colour-picker-trigger-label">{labelText}</span>
        <span className="theme-colour-picker-trigger-swatch" style={{ backgroundColor: safeValue }} aria-hidden="true" />
      </button>
      {open && (
        <div className="theme-colour-picker-popover" role="dialog" aria-label={labelText}>
          <strong>{labelText}</strong>
          <div
            className="theme-colour-picker-palette"
            role="slider"
            tabIndex={0}
            aria-label={labelText}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsl.s)}
            aria-valuetext={safeValue}
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsl.h} 100% 50%))` }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              updateFromPalette(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPalette(event);
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={adjustPalette}
          >
            <span
              className="theme-colour-picker-palette-marker"
              style={{ left: `${hsl.s}%`, top: `${100 - hsl.l}%` }}
              aria-hidden="true"
            />
          </div>
          <input
            className="theme-colour-picker-hue"
            type="range"
            min="0"
            max="360"
            value={Math.round(hsl.h)}
            aria-label={`${labelText} ${hexLabel}`}
            onChange={(event) => onChange(hslToHex({ h: Number(event.target.value), s: hsl.s, l: hsl.l }))}
          />
          <div className="theme-colour-picker-footer">
            <span className="theme-colour-picker-preview" style={{ backgroundColor: safeValue }} aria-hidden="true" />
            <label className="theme-colour-picker-hex-label">
              <span>{hexLabel}</span>
              <input
                className="theme-colour-picker-hex-input"
                type="text"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                aria-label={`${labelText} - ${hexLabel}`}
                aria-invalid={!HEX_COLOUR.test(value)}
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
