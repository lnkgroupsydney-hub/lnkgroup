export type AddressKind = 'street' | 'suburb' | 'postcode';

export type AddressSelection = {
  siteAddress: string;
  suburb: string;
  postcode: string;
  region: string;
  countryCode: string;
  placeId: string;
};

export type AddressSuggestion = { id: string; label: string };

export type AddressSearchSession = {
  search(query: string, kind: AddressKind): Promise<AddressSuggestion[]>;
  select(id: string): Promise<AddressSelection>;
  reset(): void;
};

/** The small subset of Places (New) used by this adapter. */
export type PlaceAddressComponent = {
  longText?: string;
  shortText?: string;
  types: readonly string[];
};

export type AddressFields = Pick<AddressSelection, 'siteAddress' | 'suburb' | 'postcode'>;

export type AddressPlace = {
  addressComponents?: readonly PlaceAddressComponent[] | null;
  fetchFields(request: { fields: string[] }): Promise<unknown>;
};

export type AddressPrediction = {
  placeId: string;
  text: { toString(): string };
  toPlace(): AddressPlace;
};

export type AutocompleteRequest = {
  input: string;
  includedRegionCodes: string[];
  includedPrimaryTypes: string[];
  language: string;
  region: string;
  locationBias: { center: { lat: number; lng: number }; radius: number };
  sessionToken: object;
};

export type AddressPlacesLibrary = {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: AutocompleteRequest): Promise<{
      suggestions: { placePrediction?: AddressPrediction | null }[];
    }>;
  };
};
