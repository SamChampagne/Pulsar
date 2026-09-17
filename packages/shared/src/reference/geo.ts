/**
 * Static geographic reference data (pure, browser-safe — no Node imports).
 *
 * Feeds the web `ReferenceSelect` so that a country or a province is *picked*
 * from a closed vocabulary instead of typed free-hand (hard rule 53). Codes are
 * ISO-3166-1 alpha-2 (countries) and the subdivision part of ISO-3166-2
 * (regions); labels are French, because the UI is French.
 *
 * Deliberately NOT exhaustive: it carries the countries Pulsar tenants ship
 * to/from today. Adding one is a one-line change here (plus its regions, when
 * the country has an administrative division worth picking).
 */

/** One entry of a closed reference catalog: a stable code and its French label. */
export interface ReferenceEntry {
  code: string;
  name: string;
}

/** Countries, ISO-3166-1 alpha-2, French labels. Ordered by operational relevance. */
export const COUNTRIES: readonly ReferenceEntry[] = [
  { code: 'CA', name: 'Canada' },
  { code: 'US', name: 'États-Unis' },
  { code: 'MX', name: 'Mexique' },
  { code: 'FR', name: 'France' },
  { code: 'GB', name: 'Royaume-Uni' },
  { code: 'DE', name: 'Allemagne' },
  { code: 'ES', name: 'Espagne' },
  { code: 'IT', name: 'Italie' },
  { code: 'BE', name: 'Belgique' },
  { code: 'NL', name: 'Pays-Bas' },
  { code: 'CH', name: 'Suisse' },
];

/** The 13 Canadian provinces and territories (ISO-3166-2:CA), French labels. */
const CA_REGIONS: readonly ReferenceEntry[] = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'Colombie-Britannique' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'Nouveau-Brunswick' },
  { code: 'NL', name: 'Terre-Neuve-et-Labrador' },
  { code: 'NS', name: 'Nouvelle-Écosse' },
  { code: 'NT', name: 'Territoires du Nord-Ouest' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Île-du-Prince-Édouard' },
  { code: 'QC', name: 'Québec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

/** The 50 US states plus the District of Columbia (ISO-3166-2:US), French labels. */
const US_REGIONS: readonly ReferenceEntry[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'Californie' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DC', name: 'District de Columbia' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Floride' },
  { code: 'GA', name: 'Géorgie' },
  { code: 'HI', name: 'Hawaï' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiane' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'Nouveau-Mexique' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'Caroline du Nord' },
  { code: 'ND', name: 'Dakota du Nord' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvanie' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'Caroline du Sud' },
  { code: 'SD', name: 'Dakota du Sud' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginie' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'Virginie-Occidentale' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

/**
 * Administrative regions, keyed by ISO-3166-1 alpha-2 country code. A country
 * absent from this map simply has no region picker — the field stays free text
 * (there is no useful closed vocabulary for, say, a French département here).
 */
export const REGIONS_BY_COUNTRY: Readonly<Record<string, readonly ReferenceEntry[]>> = {
  CA: CA_REGIONS,
  US: US_REGIONS,
};

const NO_REGIONS: readonly ReferenceEntry[] = [];

/**
 * Regions of `country`, or an empty list when the country is unknown, has no
 * region catalog, or is not set yet. Case- and whitespace-insensitive so a
 * value coming from a form ("  ca ") resolves like the canonical code.
 */
export function regionsFor(country: string | null | undefined): readonly ReferenceEntry[] {
  if (!country) return NO_REGIONS;
  return REGIONS_BY_COUNTRY[country.trim().toUpperCase()] ?? NO_REGIONS;
}
