import { loadGoogleAddressPlaces } from './google-places.ts';
import { createPlacesSearchSession } from './session.ts';

export { isAddressAutocompleteConfigured } from './google-places.ts';
export { mergeSelectedAddress } from './parse.ts';
export type { AddressFields, AddressKind, AddressSearchSession, AddressSelection, AddressSuggestion } from './types.ts';

export function createAddressSearchSession() {
  return createPlacesSearchSession(loadGoogleAddressPlaces);
}
