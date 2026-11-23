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
    <section className="panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-[11px] font-semibold tracking-wide text-[var(--muted)] uppercase">
          Quick dial
        </span>

        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          inputMode="tel"
          placeholder="+91 98765 43210"
          aria-label="Phone number to dial"
          className="mono w-[190px] min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-[13px] outline-none placeholder:text-[var(--muted)]/60 focus:border-[var(--accent)]"
        />

        <button
          onClick={() => setValue((v) => v.slice(0, -1))}
          disabled={!value}
          aria-label="Delete last digit"
          className="rounded-lg border border-[var(--line)] px-2 py-1.5 text-[12px] text-[var(--muted)] transition enabled:hover:text-[var(--text)] disabled:opacity-30"
        >
          ⌫
        </button>

        <button
          onClick={() => setPadOpen((o) => !o)}
          aria-expanded={padOpen}
          className="rounded-lg border border-[var(--line)] px-2 py-1.5 text-[12px] text-[var(--muted)] transition hover:text-[var(--text)]"
          title="Show keypad"
        >
          ⌨
        </button>

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
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-1.5 text-[13px] font-bold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--panel-2)] disabled:text-[var(--muted)]"
        >
          <span>📞</span> Call
        </button>

        {dialled &&
          (valid ? (
            <span className="text-[11px] text-[var(--muted)]">
              → <span className="mono font-semibold text-[var(--accent)]">{dialled}</span>
              {addedPrefix && <span> · +{countryCode} added</span>}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--warn)]">{hint}</span>
          ))}
      </div>

      {padOpen && (
        <div className="slide-up mt-3 grid w-[220px] grid-cols-3 gap-1.5">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setValue((v) => v + k)}
              className="mono rounded-lg border border-[var(--line)] bg-[var(--panel-2)] py-2 text-[15px] font-semibold transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {k}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
