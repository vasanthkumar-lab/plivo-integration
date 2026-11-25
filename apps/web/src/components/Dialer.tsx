'use client';

import { useState } from 'react';
import type { PhoneState } from '@/lib/types';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

/**
 * Decide what will actually be dialled, and whether it is complete enough to try.
 *
 * Plivo only routes E.164, and an incomplete number does not fail politely: it
 * comes back as NO_ANSWER, which reads like the other person simply did not
 * pick up. So the Call button stays disabled until the number is whole.
 *
 *   9361778524        -> +919361778524   (national, country code added)
 *   09361778524       -> +919361778524   (trunk prefix dropped)
 *   919361778524      -> +919361778524   (already carries the country code)
 *   +919361778524     -> +919361778524   (explicit international)
 *   +91936177         -> incomplete, not callable
 */
export function resolveNumber(input: string, countryCode: string, nationalLength: number) {
  const trimmed = (input ?? '').trim();
  const isIntl = trimmed.startsWith('+') || trimmed.startsWith('00');
  let d = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('00')) d = d.slice(2);

  const blank = { dialled: '', valid: false, hint: '', addedPrefix: false };
  if (!d) return blank;

  // Written as an international number: trust the country code the user gave,
  // but require a plausible full length (E.164 allows at most 15 digits).
  if (isIntl) {
    const valid = d.length >= 11 && d.length <= 15;
    return {
      dialled: `+${d}`,
      valid,
      hint: valid ? '' : `${d.length} digits — needs at least 11 with the country code`,
      addedPrefix: false,
    };
  }

  // Already includes the country code, e.g. 919361778524
  if (d.startsWith(countryCode) && d.length === countryCode.length + nationalLength) {
    return { dialled: `+${d}`, valid: true, hint: '', addedPrefix: false };
  }

  // Trunk prefix, e.g. 09361778524
  if (d.length === nationalLength + 1 && d.startsWith('0')) {
    return { dialled: `+${countryCode}${d.slice(1)}`, valid: true, hint: '', addedPrefix: true };
  }

  // Plain national number
  if (d.length === nationalLength) {
    return { dialled: `+${countryCode}${d}`, valid: true, hint: '', addedPrefix: true };
  }

  return {
    dialled: `+${countryCode}${d}`,
    valid: false,
    hint: `${d.length} of ${nationalLength} digits`,
    addedPrefix: true,
  };
}

/**
 * Compact dialler. The keypad is collapsed by default — typing is faster on a
 * laptop, and the pipeline below is the main view.
 */
export function Dialer({
  phone,
  defaultNumber,
  countryCode = '91',
  nationalLength = 10,
  onCall,
}: {
  phone: PhoneState;
  defaultNumber: string;
  countryCode?: string;
  nationalLength?: number;
  onCall: (number: string) => void;
}) {
  const [value, setValue] = useState(defaultNumber);
  const [padOpen, setPadOpen] = useState(false);

  const canCall = phone.kind === 'ready';
  const { dialled, valid, hint, addedPrefix } = resolveNumber(value, countryCode, nationalLength);

  const submit = () => {
    if (!canCall || !valid) return;
    onCall(dialled);
  };

  return (
    /* A vertical stack, not a wrapping row: this panel lives in a ~320px rail,
       where a single flex line pushed the Call button onto its own ragged row. */
    <section className="panel p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
          Quick dial
        </h2>
        <button
          onClick={() => setPadOpen((o) => !o)}
          aria-expanded={padOpen}
          aria-label={padOpen ? 'Hide keypad' : 'Show keypad'}
          title={padOpen ? 'Hide keypad' : 'Show keypad'}
          className={`rounded-lg border px-2 py-1 text-[12px] transition ${
            padOpen
              ? 'border-[var(--accent)] bg-[var(--accent)]/8 text-[var(--accent)]'
              : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          ⌨
        </button>
      </div>

      {/* Backspace sits inside the field so the input can use the full width. */}
      <div className="relative">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          inputMode="tel"
          placeholder="+91 98765 43210"
          aria-label="Phone number to dial"
          className="mono w-full rounded-xl border border-[var(--line)] bg-[var(--panel-2)] py-2.5 pr-10 pl-3 text-[14px] outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)]"
        />
        {value && (
          <button
            onClick={() => setValue((v) => v.slice(0, -1))}
            aria-label="Delete last digit"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md px-1.5 py-1 text-[13px] text-[var(--muted)] transition hover:text-[var(--text)]"
          >
            ⌫
          </button>
        )}
      </div>

      {/* Reserve the line so the Call button does not jump as you type. */}
      <div className="mt-1.5 min-h-[16px] px-0.5 text-[11px]">
        {dialled &&
          (valid ? (
            <span className="text-[var(--muted)]">
              → <span className="mono font-semibold text-[var(--accent)]">{dialled}</span>
              {addedPrefix && <span> · +{countryCode} added</span>}
            </span>
          ) : (
            <span className="text-[var(--warn)]">{hint}</span>
          ))}
      </div>

      <button
        onClick={submit}
        disabled={!canCall || !valid}
        title={
          !canCall
            ? 'Register the phone first'
            : !valid
              ? `Enter ${nationalLength} digits, or a full number with country code`
              : `Call ${dialled}`
        }
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] py-2.5 text-[14px] font-bold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--panel-2)] disabled:text-[var(--muted)]"
      >
        <span aria-hidden="true">📞</span> Call
      </button>

      {padOpen && (
        <div className="slide-up mt-3 grid w-full grid-cols-3 gap-1.5">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setValue((v) => v + k)}
              className="mono rounded-xl border border-[var(--line)] bg-[var(--panel-2)] py-2.5 text-[15px] font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {k}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
