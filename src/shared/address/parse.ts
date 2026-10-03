import type { AddressFields, AddressKind, AddressSelection, PlaceAddressComponent } from './types.ts';

const clean = (value: string | undefined) => value?.trim().replace(/\s+/g, ' ') ?? '';

export function parseAustralianAddress(
  components: readonly PlaceAddressComponent[] | null | undefined,
  placeId: string,
): AddressSelection {
  const parts = components ?? [];
  const component = (type: string) => parts.find((part) => part.types.includes(type));
  const long = (type: string) => clean(component(type)?.longText);
  const country = component('country');
  const countryCode = clean(country?.shortText).toUpperCase()
    || (clean(country?.longText).toLowerCase() === 'australia' ? 'AU' : '');
  if (country && countryCode !== 'AU') throw new Error('Please select an Australian address.');

  const route = long('route');
  const number = long('street_number');
  const unit = long('subpremise');
  const street = route ? [number, route].filter(Boolean).join(' ') : '';
  const siteAddress = street && unit ? `Unit ${unit}, ${street}` : street;
  const state = component('administrative_area_level_1');
  const postcode = long('postal_code');

  return {
    siteAddress,
    suburb: long('locality') || long('postal_town') || long('sublocality_level_1') || long('sublocality'),
    postcode: /^\d{4}$/.test(postcode) ? postcode : '',
    region: clean(state?.shortText) || clean(state?.longText),
    countryCode,
    placeId,
  };
}

const comparable = (value: string) => clean(value).toLocaleLowerCase('en-AU');

function comparableStreet(value: string) {
  const suffixes: Record<string, string> = {
    st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', dr: 'drive',
    ct: 'court', pl: 'place', cres: 'crescent', hwy: 'highway', pde: 'parade',
  };
  return comparable(value).replace(/[.,]/g, '').split(/\s+/)
    .map((part) => suffixes[part] ?? part).join(' ');
}

function retainMatchingUnit(currentStreet: string, selectedStreet: string) {
  const unit = currentStreet.match(/^(?:unit|apartment|apt|flat|suite|u)\s+([\w-]+)[,\s]+(.+)$/i)
    ?? currentStreet.match(/^([\w-]+)\s*\/\s*(\d.+)$/);
  if (!unit || !selectedStreet || comparableStreet(unit[2]) !== comparableStreet(selectedStreet)) return selectedStreet;
  return `Unit ${unit[1]}, ${selectedStreet}`;
}

/** Update related fields together; a new locality must not inherit an unrelated street. */
export function mergeSelectedAddress(
  current: AddressFields,
  selected: AddressSelection,
  kind: AddressKind,
): AddressFields {
  if (kind === 'street') {
    const compatibleLocation = (!current.suburb || !selected.suburb || comparable(current.suburb) === comparable(selected.suburb))
      && (!current.postcode || !selected.postcode || current.postcode.trim() === selected.postcode);
    return {
      siteAddress: compatibleLocation ? retainMatchingUnit(current.siteAddress, selected.siteAddress) : selected.siteAddress,
      suburb: selected.suburb,
      postcode: selected.postcode,
    };
  }

  // `current` already includes the user's new query. Matching it cannot prove the
  // previous street belonged to the selected area, especially for shared postcodes.
  return {
    siteAddress: '',
    suburb: selected.suburb,
    // A suburb can span postal areas; never guess a postcode Google did not provide.
    postcode: selected.postcode,
  };
}
