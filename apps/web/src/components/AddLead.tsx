'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/** Add a real contact to the pipeline. */
export function AddLead({ onAdded }: { onAdded: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = phone.replace(/\D/g, '').length >= 10;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await api.createLead({
        name: name.trim(),
        company: company.trim(),
        phone: phone.trim(),
        value: Number(value.replace(/\D/g, '') || 0),
      });
      onAdded(name.trim() || phone.trim());
      setName('');
      setCompany('');
      setPhone('');
      setValue('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="border-t border-[var(--line)] px-4 py-3">
        <button
          onClick={() => setOpen(true)}
          className="text-[12px] font-semibold text-[var(--accent)] hover:brightness-125"
        >
          + Add contact
        </button>
      </div>
    );
  }

  return (
    <div className="slide-up border-t border-[var(--line)] px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Name" value={name} onChange={setName} placeholder="Full name" />
        <Field label="Company" value={company} onChange={setCompany} placeholder="Company" />
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="+91 98765 43210" mono />
        <Field label="Deal value" value={value} onChange={setValue} placeholder="450000" mono />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={!valid || busy}
          className="rounded-lg bg-[var(--accent)] px-4 py-1.5 text-[12px] font-bold text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--panel-2)] disabled:text-[var(--muted)]"
        >
          {busy ? 'Saving…' : 'Save contact'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="px-2 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          Cancel
        </button>
        {!valid && phone && (
          <span className="text-[11px] text-[var(--warn)]">Enter a full phone number</span>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-1.5 text-[13px] outline-none placeholder:text-[var(--muted)]/50 focus:border-[var(--accent)] ${mono ? 'mono' : ''}`}
      />
    </label>
  );
}
