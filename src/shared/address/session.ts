import { parseAustralianAddress } from './parse.ts';
import type { AddressKind, AddressPlacesLibrary, AddressPrediction, AddressSearchSession, AddressSuggestion } from './types.ts';

export const ADDRESS_UNAVAILABLE = 'Address suggestions are unavailable. Please enter your address manually.';

export function withAddressTimeout<T>(operation: Promise<T>, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(ADDRESS_UNAVAILABLE)), timeoutMs);
    operation.then((value) => { clearTimeout(timer); resolve(value); }, () => {
      clearTimeout(timer);
      reject(new Error(ADDRESS_UNAVAILABLE));
    });
  });
}

const primaryTypes: Record<AddressKind, string[]> = {
  street: ['street_address', 'premise', 'subpremise', 'route'],
  suburb: ['locality', 'sublocality', 'sublocality_level_1', 'postal_town'],
  postcode: ['postal_code'],
};

/** Provider injection keeps race handling and field/billing contracts verifiable without paid requests. */
export function createPlacesSearchSession(loadPlaces: () => Promise<AddressPlacesLibrary>): AddressSearchSession {
  let revision = 0;
  let token: object | undefined;
  let predictions = new Map<string, AddressPrediction>();

  return {
    async search(query, kind) {
      const requestRevision = ++revision;
      predictions.clear();
      const input = query.trim();
      if (input.length < (kind === 'postcode' ? 2 : 3)) return [];
      try {
        const library = await loadPlaces();
        if (requestRevision !== revision) return [];
        token ??= new library.AutocompleteSessionToken();
        const { suggestions } = await withAddressTimeout(library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          includedRegionCodes: ['au'],
          includedPrimaryTypes: [...primaryTypes[kind]],
          language: 'en-AU',
          region: 'au',
          // Ranking preference only; addresses anywhere in Australia remain selectable.
          locationBias: { center: { lat: -33.815, lng: 151.055 }, radius: 50_000 },
          sessionToken: token,
        }));
        if (requestRevision !== revision) return [];
        const next = new Map<string, AddressPrediction>();
        const results: AddressSuggestion[] = [];
        for (const { placePrediction } of suggestions) {
          if (!placePrediction?.placeId || next.has(placePrediction.placeId)) continue;
          const label = placePrediction.text.toString().trim();
          if (!label) continue;
          next.set(placePrediction.placeId, placePrediction);
          results.push({ id: placePrediction.placeId, label });
        }
        predictions = next;
        return results;
      } catch {
        if (requestRevision !== revision) return [];
        throw new Error(ADDRESS_UNAVAILABLE);
      }
    },
    async select(id) {
      const prediction = predictions.get(id);
      const selectionRevision = ++revision;
      predictions.clear();
      // toPlace carries the autocomplete token. A details attempt ends that session.
      token = undefined;
      if (!prediction) throw new Error('Please search for the address again.');
      try {
        const place = prediction.toPlace();
        await withAddressTimeout(place.fetchFields({ fields: ['addressComponents'] }));
        if (selectionRevision !== revision) throw new Error(ADDRESS_UNAVAILABLE);
        return parseAustralianAddress(place.addressComponents, id);
      } catch {
        throw new Error(ADDRESS_UNAVAILABLE);
      }
    },
    reset() {
      revision++;
      predictions.clear();
      token = undefined;
    },
  };
}
