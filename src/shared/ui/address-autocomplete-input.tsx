"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";
import {
  createAddressSearchSession,
  isAddressAutocompleteConfigured,
  type AddressKind,
  type AddressSelection,
  type AddressSuggestion,
} from "@/shared/address";
import "./address-autocomplete-input.css";
import { ValidatedInput } from './validated-input';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> & {
  value: string;
  kind: AddressKind;
  /** All related address fields, so a late result cannot overwrite another edit. */
  addressContext: string;
  onAddressSelect: (address: AddressSelection, kind: AddressKind) => void;
  /** A single-field customer record needs different confirmation from split fields. */
  selectionMessage?: string;
  validationLabel?: string;
  requireLetter?: boolean;
};
type SearchState = {
  phase: "idle" | "waiting" | "loading" | "results" | "selecting" | "message";
  query: string;
  context: string;
  suggestions: AddressSuggestion[];
  activeIndex: number;
  message: string;
};
const EMPTY: SearchState = { phase: "idle", query: "", context: "", suggestions: [], activeIndex: -1, message: "" };
const UNAVAILABLE = "Address suggestions are unavailable. Enter your address manually.";

export function AddressAutocompleteInput({
  value, kind, addressContext, onAddressSelect, selectionMessage, validationLabel, requireLetter = kind !== 'postcode', id, disabled, readOnly, autoComplete,
  onChange, onFocus, onBlur, onKeyDown, onCompositionStart, onCompositionEnd,
  "aria-describedby": describedBy, ...inputProps
}: Props) {
  const generatedId = useId();
  const inputId = id ?? `address-${generatedId}`;
  const listId = `${inputId}-suggestions`;
  const statusId = `${inputId}-search-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<ReturnType<typeof createAddressSearchSession> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const focusedRef = useRef(false);
  const composingRef = useRef(false);
  const controlledRef = useRef({ value, context: addressContext });
  const [focused, setFocused] = useState(false);
  const [search, setSearch] = useState<SearchState>(EMPTY);
  const configured = isAddressAutocompleteConfigured();

  useLayoutEffect(() => {
    controlledRef.current = { value, context: addressContext };
  }, [value, addressContext]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      sessionRef.current?.reset();
    };
  }, []);

  function cancelPending(resetSession: boolean) {
    generationRef.current += 1;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (resetSession) {
      sessionRef.current?.reset();
      sessionRef.current = null;
    }
  }

  function stillCurrent(generation: number, query: string, context: string) {
    return mountedRef.current && focusedRef.current && !composingRef.current
      && generationRef.current === generation && inputRef.current?.value === query
      && controlledRef.current.context === context && !inputRef.current.matches(":disabled")
      && !inputRef.current.readOnly;
  }

  function requestSuggestions(query: string) {
    cancelPending(false);
    const minimum = kind === "postcode" ? 2 : 3;
    if (!configured || disabled || readOnly || composingRef.current || query.trim().length < minimum) {
      setSearch(EMPTY);
      return;
    }
    const generation = generationRef.current;
    setSearch({ ...EMPTY, phase: "waiting", query });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const context = controlledRef.current.context;
      if (!stillCurrent(generation, query, context)) return;
      const session = sessionRef.current ??= createAddressSearchSession();
      setSearch({ ...EMPTY, phase: "loading", query, context });
      void session.search(query, kind).then((suggestions) => {
        if (!stillCurrent(generation, query, context)) return;
        setSearch({
          phase: suggestions.length ? "results" : "message", query, context, suggestions,
          activeIndex: suggestions.length ? 0 : -1,
          message: suggestions.length ? `${suggestions.length} address suggestions. Use the arrow keys and Enter to choose.` : "No matching address found. Try more detail or enter it manually.",
        });
      }).catch(() => {
        if (!stillCurrent(generation, query, context)) return;
        session.reset();
        setSearch({ ...EMPTY, phase: "message", query, context, message: UNAVAILABLE });
      });
    }, 300);
  }

  async function choose(suggestion: AddressSuggestion) {
    const session = sessionRef.current;
    if (!session || search.query !== value || search.context !== addressContext || disabled || readOnly) return;
    cancelPending(false);
    // Further typing starts a new session; the in-flight details request owns this one.
    sessionRef.current = null;
    const generation = generationRef.current;
    const query = value;
    const context = addressContext;
    setSearch({ ...EMPTY, phase: "selecting", query, context });
    try {
      const selection = await session.select(suggestion.id);
      if (!stillCurrent(generation, query, context)) return;
      onAddressSelect(selection, kind);
      setSearch({ ...EMPTY, phase: "message", message: selectionMessage ?? "Address details updated. Check the street, suburb and postcode; enter any missing details and unit or apartment number." });
    } catch {
      if (stillCurrent(generation, query, context)) setSearch({ ...EMPTY, phase: "message", query, context, message: UNAVAILABLE });
    } finally {
      session.reset();
    }
  }

  const matchingSearch = search.query === value && search.context === addressContext;
  const showResults = focused && matchingSearch && search.phase === "results" && !disabled && !readOnly;
  const activeOption = showResults ? search.suggestions[search.activeIndex] : undefined;
  const message = !configured && focused ? UNAVAILABLE
    : matchingSearch && search.phase === "loading" ? "Searching addresses…"
    : matchingSearch && search.phase === "selecting" ? "Loading selected address…"
    : search.message && (matchingSearch || !search.query) ? search.message
    : focused && configured ? "Type to search Google Maps. Search text is sent to Google; you can also enter the address manually." : "";

  return <div className="address-autocomplete">
    <div className="address-autocomplete-control">
    <ValidatedInput
      {...inputProps}
      validation={kind === 'postcode' ? 'postcode' : 'text'}
      validationLabel={validationLabel ?? (kind === 'street' ? 'the site address' : kind === 'suburb' ? 'the suburb' : 'the postcode')}
      requireLetter={requireLetter}
      ref={inputRef}
      id={inputId}
      value={value}
      disabled={disabled}
      readOnly={readOnly}
      autoComplete={configured ? "off" : autoComplete}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={showResults}
      aria-controls={showResults ? listId : undefined}
      aria-activedescendant={activeOption ? `${listId}-${search.activeIndex}` : undefined}
      aria-describedby={[describedBy, statusId].filter(Boolean).join(" ")}
      onChange={(event) => {
        onChange?.(event);
        requestSuggestions(event.currentTarget.value);
      }}
      onFocus={(event) => {
        focusedRef.current = true;
        setFocused(true);
        onFocus?.(event);
        requestSuggestions(event.currentTarget.value);
      }}
      onBlur={(event) => {
        focusedRef.current = false;
        setFocused(false);
        cancelPending(true);
        setSearch(EMPTY);
        onBlur?.(event);
      }}
      onCompositionStart={(event) => {
        composingRef.current = true;
        cancelPending(false);
        setSearch(EMPTY);
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        onCompositionEnd?.(event);
        requestSuggestions(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          cancelPending(true);
          setSearch(EMPTY);
        } else if (showResults && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setSearch((current) => ({ ...current, activeIndex: (current.activeIndex + direction + current.suggestions.length) % current.suggestions.length }));
        } else if (event.key === "Enter" && activeOption) {
          event.preventDefault();
          void choose(activeOption);
        } else if (event.key === "Enter" && search.query === value && (search.phase === "waiting" || (matchingSearch && (search.phase === "loading" || search.phase === "selecting")))) {
          event.preventDefault();
        }
      }}
    />
    {showResults && <div className="address-autocomplete-panel">
      <ul id={listId} role="listbox" aria-label="Google address suggestions" className="address-autocomplete-options">
        {search.suggestions.map((suggestion, index) => <li key={suggestion.id} role="presentation">
          <button
            type="button"
            role="option"
            id={`${listId}-${index}`}
            aria-selected={index === search.activeIndex}
            tabIndex={-1}
            onPointerDown={(event) => event.preventDefault()}
            onPointerMove={() => setSearch((current) => ({ ...current, activeIndex: index }))}
            onClick={() => void choose(suggestion)}
          >{suggestion.label}</button>
        </li>)}
      </ul>
      <div className="address-autocomplete-attribution" translate="no">Google Maps</div>
    </div>}
    </div>
    <span id={statusId} className="address-autocomplete-status" role="status" aria-live="polite">{message}</span>
  </div>;
}
