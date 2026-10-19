"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LatLng } from "@/lib/utils";

export type SearchSuggestion = {
  id: string;
  title: string;
  subtitle: string;
  displayName: string;
  lat: number;
  lng: number;
  source: "local" | "nominatim" | "photon";
};

type AddressAutocompleteProps = {
  label: string;
  placeholder: string;
  value: LatLng | null;
  address: string | null;
  onSelect: (point: LatLng, address: string) => void;
  onClear?: () => void;
  accent?: "primary" | "success";
  disabled?: boolean;
};

const DEBOUNCE_MS = 450;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 5;

export default function AddressAutocomplete({
  label,
  placeholder,
  value,
  address,
  onSelect,
  onClear,
  accent = "primary",
  disabled = false,
}: AddressAutocompleteProps) {
  // The parent passes a `key` derived from the address, so when GPS or a map tap
  // replaces the location this component remounts with the new text. That avoids
  // an effect that would synchronise props into state on every change.
  const [query, setQuery] = useState(address ?? "");
  const [results, setResults] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(false);

  const listId = useId();

  function handleChange(next: string) {
    lockedRef.current = false;
    setQuery(next);
    setError(null);
    if (next.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      setOpen(false);
    }
  }

  function handleClear() {
    lockedRef.current = false;
    setQuery("");
    setResults([]);
    setOpen(false);
    setError(null);
    onClear?.();
  }

  function choose(result: SearchSuggestion) {
    lockedRef.current = true;
    onSelect({ lat: result.lat, lng: result.lng }, result.displayName);
    setOpen(false);
    setResults([]);
    setQuery(result.displayName);
  }

  // Auto-select cerdas: tanpa klik dropdown pun koordinat selalu terkunci ke
  // rekomendasi teratas — tombol Pesan tidak pernah gagal karena lat/lng kosong.
  function autoLock() {
    if (lockedRef.current || results.length === 0) return;
    choose(results[highlight] ?? results[0]);
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH || lockedRef.current) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
        const data = (await res.json()) as { suggestions?: SearchSuggestion[] };
        const list = Array.isArray(data.suggestions) ? data.suggestions : [];
        // Batasi maksimal 4-5 hasil untuk render ringan
        setResults(list.slice(0, MAX_SUGGESTIONS));
        setHighlight(0);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setResults([]);
        setError("Gagal mencari alamat. Coba lagi.");
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        // Klik di luar = selesai mengetik → kunci rekomendasi teratas.
        autoLock();
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, highlight]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      // Enter selalu mengunci: hasil sorotan bila dropdown terbuka,
      // atau hasil pertama bila sudah ada.
      if (results.length > 0) {
        event.preventDefault();
        const target = open ? (results[highlight] ?? results[0]) : results[0];
        if (target) choose(target);
      }
      return;
    }
    if (!open || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  // Jemput = pin hijau bulat, Tujuan = pin merah (ala Gojek).
  const accentRing =
    accent === "success"
      ? "focus-within:border-red-200 focus-within:ring-red-200/60"
      : "focus-within:border-green-200 focus-within:ring-green-200/60";

  const showClear = !disabled && !loading && (query.trim().length > 0 || Boolean(value));

  return (
    <div className="relative overflow-visible" ref={containerRef}>
      <div
        className={`flex items-center gap-2 rounded-2xl border border-blue-100 bg-white px-3 py-2 shadow-sm transition focus-within:shadow-md focus-within:ring-4 ${accentRing}`}
      >
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white shadow ${
            accent === "success" ? "bg-red-500" : "bg-green-500"
          }`}
          aria-hidden
        >
          {accent === "success" ? "◉" : "◎"}
        </span>
        <div className="min-w-0 flex-1">
          <label
            htmlFor={listId}
            className="block text-[10px] font-semibold uppercase tracking-wide text-blue-700"
          >
            {label}
          </label>
          <input
            id={listId}
            type="text"
            value={query}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              setOpen(false);
              autoLock();
            }}
            onFocus={() => results.length > 0 && setOpen(true)}
            autoComplete="off"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${listId}-listbox`}
            aria-autocomplete="list"
            className="w-full bg-transparent text-[13px] font-medium text-[#0F172A] outline-none placeholder:text-slate-400 disabled:opacity-60"
          />
        </div>
        {loading && (
          <span className="shrink-0 text-[11px] font-semibold text-[#1D4ED8]">mencari...</span>
        )}
        {showClear && (
          <button
            type="button"
            onClick={handleClear}
            aria-label={`Hapus ${label.toLowerCase()}`}
            title="Hapus teks"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
          >
            ✕
          </button>
        )}
      </div>

      {open && (results.length > 0 || error) && (
        <ul
          id={`${listId}-listbox`}
          role="listbox"
          className="absolute z-[9999] mt-1.5 max-h-60 w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl"
        >
          {error && <li className="px-3 py-2 text-xs text-red-600">{error}</li>}
          {results.map((result, index) => (
            <li key={result.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(result)}
                className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-3 text-left transition min-h-[48px] ${
                  index === highlight
                    ? "bg-[#EFF6FF] text-[#1D4ED8]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs shadow-sm ${
                    accent === "success"
                      ? "bg-red-100 text-red-600"
                      : "bg-blue-100 text-[#1D4ED8]"
                  }`}
                  aria-hidden
                >
                  📍
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block truncate text-[13px] font-bold text-[#0F172A]">
                    {result.title}
                  </span>
                  {result.subtitle && (
                    <span className="block truncate text-[11px] font-normal text-slate-500">
                      {result.subtitle}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
