"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { LatLng } from "@/lib/utils";
import {
  BOGOR_TRAINING_LOCATIONS,
  searchBogorLocations,
  type BogorLocation,
} from "@/lib/bogorLocations";

export type SearchSuggestion = {
  id: string;
  title: string;
  subtitle: string;
  displayName: string;
  lat: number;
  lng: number;
  source: "local" | "nominatim" | "photon" | "training";
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
  /** Force show training chips (useful on mobile for quick access) */
  showTrainingChipsDefault?: boolean;
};

const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 5;

function bogorToSuggestion(loc: BogorLocation): SearchSuggestion {
  return {
    id: `training-${loc.id}`,
    title: loc.label,
    subtitle: loc.address,
    displayName: loc.address,
    lat: loc.lat,
    lng: loc.lng,
    source: "training",
  };
}

export default function AddressAutocomplete({
  label,
  placeholder,
  value,
  address,
  onSelect,
  onClear,
  accent = "primary",
  disabled = false,
  showTrainingChipsDefault = false,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(address ?? "");
  const [results, setResults] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lockedRef = useRef(false);

  const listId = useId();

  // On mobile, show training chips by default when input is empty (not focused)
  const [showTrainingChips, setShowTrainingChips] = useState(() =>
    showTrainingChipsDefault || (typeof window !== "undefined" && window.innerWidth < 768 && !address?.trim())
  );

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  function handleChange(next: string) {
    lockedRef.current = false;
    setQuery(next);
    setError(null);
    // Hide chips when typing (both mobile and desktop unless forced)
    if (!showTrainingChipsDefault) {
      setShowTrainingChips(next.trim().length === 0);
    }
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
    setShowTrainingChips(true);
    onClear?.();
  }

  function choose(result: SearchSuggestion) {
    lockedRef.current = true;
    onSelect({ lat: result.lat, lng: result.lng }, result.displayName);
    setOpen(false);
    setResults([]);
    setShowTrainingChips(false);
    setQuery(result.displayName);
  }

  function selectTrainingLocation(loc: BogorLocation) {
    lockedRef.current = true;
    const { lat, lng, address: addr } = loc;
    onSelect({ lat, lng }, addr);
    setOpen(false);
    setResults([]);
    setShowTrainingChips(false);
    setQuery(addr);
  }

  function autoLock() {
    if (lockedRef.current || results.length === 0) return;
    choose(results[highlight] ?? results[0]);
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH || lockedRef.current) return;
    setShowTrainingChips(false);

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // Prioritaskan pencarian lokal (titik latihan Bogor)
        const localMatches = searchBogorLocations(trimmed, 3).map(bogorToSuggestion);

        const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
        const data = (await res.json()) as { suggestions?: SearchSuggestion[] };
        const apiList = Array.isArray(data.suggestions) ? data.suggestions : [];

        // Gabungkan: lokal dulu, lalu API, hapus duplikat by coordinate
        const seen = new Set<string>();
        const merged: SearchSuggestion[] = [];
        for (const s of [...localMatches, ...apiList]) {
          const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(s);
          if (merged.length >= MAX_SUGGESTIONS) break;
        }

        setResults(merged);
        setHighlight(0);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Fallback ke lokal saja jika API gagal
        const localMatches = searchBogorLocations(trimmed, MAX_SUGGESTIONS).map(bogorToSuggestion);
        setResults(localMatches);
        setHighlight(0);
        setOpen(true);
        setError(localMatches.length === 0 ? "Gagal mencari alamat. Coba lagi." : null);
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
        autoLock();
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, highlight]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
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
            onFocus={() => {
              // On mobile, chips already show by default when empty; only force show on desktop
              if (!isMobile) setShowTrainingChips(true);
              if (results.length > 0) setOpen(true);
            }}
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

      {showTrainingChips && !disabled && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Titik latihan cepat">
          {BOGOR_TRAINING_LOCATIONS.slice(0, 6).map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => selectTrainingLocation(loc)}
              className="rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-medium text-[#1D4ED8] shadow-sm ring-1 ring-blue-100 transition hover:bg-[#EFF6FF] hover:shadow-md disabled:opacity-60 min-h-[40px]"
            >
              🏷️ {loc.label}
            </button>
          ))}
        </div>
      )}

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
                      : result.source === "training"
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-blue-100 text-[#1D4ED8]"
                  }`}
                  aria-hidden
                >
                  {result.source === "training" ? "🏷️" : "📍"}
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
