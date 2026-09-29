/**
 * The Zod-free subset of @suskii/shared: constants and pure helpers. Browser code that runs before
 * any validation (form rendering, formatting) imports `@suskii/shared/lite`, so Zod stays out of
 * the web homepage's initial JavaScript; the main entry, with the schemas, loads where it is
 * needed (for example when a form is submitted). lite.test.ts keeps this entry free of Zod.
 */
export { BRAND, NEWSLETTER_CONSENT_VERSION } from './brand';
export {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
  type CurrencyCode,
} from './currency-codes';
export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type LocaleCode,
} from './locale-codes';
export {
  ROUNDING_MODES,
  add,
  currencyExponent,
  formatMoney,
  fromWire,
  money,
  roundDiv,
  toWire,
  type Money,
  type MoneyWire,
  type RoundingMode,
} from './money';
export {
  CABIN_CLASSES,
  MAX_FLIGHT_SLICES,
  MIN_MULTI_CITY_LEGS,
  TRIP_TYPES,
  type CabinClass,
  type TripType,
} from './search-limits';
export { addDays, earliestToday, isValidDate } from './time';
export {
  DEFAULT_TRAVELLERS,
  MAX_TRAVELLERS,
  TRAVELLER_TYPES,
  canDecrement,
  canIncrement,
  stepTravellers,
  totalTravellers,
  type TravellerCounts,
  type TravellerType,
} from './traveller-rules';
export {
  BOOKING_IN_PROGRESS_STATUSES,
  BOOKING_STATUSES,
  BOOKING_TERMS_VERSION,
  type BookingStatus,
} from './booking-rules';
export {
  FULL_NAME_MAX_LENGTH,
  GENDERS,
  NAME_MAX_LENGTH,
  PASSENGER_ISSUES,
  PASSENGER_TITLES,
  PASSENGER_TYPES,
  ageOn,
  checkPassengers,
  passengerTypeForAge,
  transliterateName,
  type Gender,
  type ItineraryFacts,
  type PassengerIssue,
  type PassengerTitle,
  type PassengerType,
} from './passenger-rules';
