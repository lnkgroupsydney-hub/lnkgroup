import { ADDRESS_UNAVAILABLE, withAddressTimeout } from './session.ts';
import type { AddressPlacesLibrary } from './types.ts';

type MapsWindow = Window & {
  google?: { maps?: { importLibrary(name: 'places'): Promise<AddressPlacesLibrary> } };
  gm_authFailure?: () => void;
  __lkAddressMapsReady?: () => void;
};

let libraryPromise: Promise<AddressPlacesLibrary> | undefined;
let authFailed = false;

export function isAddressAutocompleteConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim());
}

/** Called on an intentional search, never on render or server requests. */
export function loadGoogleAddressPlaces(): Promise<AddressPlacesLibrary> {
  if (typeof window === 'undefined' || !isAddressAutocompleteConfigured() || authFailed) {
    return Promise.reject(new Error(ADDRESS_UNAVAILABLE));
  }
  if (libraryPromise) return libraryPromise;

  const mapsWindow = window as MapsWindow;
  const loaded = new Promise<void>((resolve, reject) => {
    const previousAuthFailure = mapsWindow.gm_authFailure;
    mapsWindow.gm_authFailure = () => {
      authFailed = true;
      reject(new Error(ADDRESS_UNAVAILABLE));
      previousAuthFailure?.();
    };
    if (mapsWindow.google?.maps?.importLibrary) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.id = 'lk-google-address-places';
    script.async = true;
    const parameters = new URLSearchParams({
      key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!.trim(),
      loading: 'async',
      callback: '__lkAddressMapsReady',
      v: 'weekly',
      language: 'en-AU',
      region: 'AU',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${parameters}`;
    script.nonce = document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? '';
    mapsWindow.__lkAddressMapsReady = () => {
      if (authFailed) reject(new Error(ADDRESS_UNAVAILABLE));
      else resolve();
    };
    script.onerror = () => reject(new Error(ADDRESS_UNAVAILABLE));
    document.head.appendChild(script);
  });

  // Retain the promise on failure too: typing must not inject repeated scripts or bill retries.
  libraryPromise = withAddressTimeout(loaded.then(async () => {
    if (authFailed || !mapsWindow.google?.maps?.importLibrary) throw new Error(ADDRESS_UNAVAILABLE);
    const library = await mapsWindow.google.maps.importLibrary('places');
    if (authFailed || !library.AutocompleteSuggestion || !library.AutocompleteSessionToken) {
      throw new Error(ADDRESS_UNAVAILABLE);
    }
    return library;
  }));
  return libraryPromise;
}
