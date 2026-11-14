import { ROUTE_TOOL, type MockScript } from '../model/mock-model.js';
import { type ModelMessage, type ModelRequest } from '../model/model.js';

/**
 * The turns a model would play when a traveller asks Ask Suskii for a whole trip, Lagos to
 * London with the cheapest flight, stay and rental car, on one payment (ADR-117). It reads the
 * days from the traveller's own message and every id from what the tools really returned, as a
 * model must; the only things it knows beforehand are the airports and the city the message
 * names. For the API's end-to-end suite through the agent service (scripted-service.ts).
 */

const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/g;

/** The closing answer: no figure, nothing said to have happened, the next step named. */
export const WHOLE_TRIP_ANSWER =
  'I prepared the cheapest flight, a hotel in London and a rental car there, and put them on one trip. Open the trip to enter everyone’s details once, then pay for everything in one payment.';

type ToolMessage = Extract<ModelMessage, { role: 'tool' }>;

const toolMessages = (request: ModelRequest, tool: string): ToolMessage[] =>
  request.messages.filter(
    (message): message is ToolMessage => message.role === 'tool' && message.name === tool,
  );

/**
 * Whether the tool was called in this turn, answered or refused: each step runs once, so a
 * refusal shows in the test instead of a loop until the run's tool limit.
 */
const called = (request: ModelRequest, tool: string): boolean =>
  toolMessages(request, tool).length > 0;

/** What a tool answered in this turn, read as the model reads it: JSON. Refusals are left out. */
function answers(request: ModelRequest, tool: string): unknown[] {
  return toolMessages(request, tool)
    .filter((message) => !message.isError)
    .map((message) => {
      try {
        return JSON.parse(message.content) as unknown;
      } catch {
        return null;
      }
    });
}

/**
 * `field` of the first entry in the result's `list` that `matches`: the cheapest, as the search
 * sorted them, or the place the traveller named.
 */
function pick(
  result: unknown,
  list: string,
  field: string,
  matches: (entry: Record<string, unknown>) => boolean = () => true,
): string | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const entries = (result as Record<string, unknown>)[list];
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const value = record[field];
    if (matches(record) && typeof value === 'string' && value) return value;
  }
  return undefined;
}

export const wholeTripScript: MockScript = (request) => {
  if (request.role === 'router') {
    return { toolCalls: [{ name: ROUTE_TOOL, arguments: { agent: 'trip_builder' } }] };
  }
  const said = request.messages.findLast((message) => message.role === 'user');
  const [depart, back] = (said?.role === 'user' ? said.text : '').match(ISO_DAY) ?? [];
  if (!depart || !back) return { text: 'Which day do you leave, and which day do you come back?' };
  // The flight lands in the evening; the car goes back on the morning of the flight home.
  const pickupAt = `${depart}T18:00`;
  const returnAt = `${back}T09:00`;

  if (!called(request, 'flights__search')) {
    return {
      toolCalls: [
        {
          name: 'flights__search',
          arguments: {
            origin: 'LOS',
            destination: 'LHR',
            departDate: depart,
            returnDate: back,
            adults: 1,
            sort: 'cheapest',
            limit: 3,
          },
        },
        { name: 'catalog__places', arguments: { query: 'London', limit: 5 } },
      ],
    };
  }
  if (!called(request, 'hotels__search')) {
    return {
      toolCalls: [
        {
          name: 'flights__prepare_booking',
          arguments: { offerId: pick(answers(request, 'flights__search')[0], 'offers', 'offerId') },
        },
        {
          name: 'hotels__search',
          arguments: {
            // A city's id is the `id` of its entry; airports carry codes, for flights.
            cityId: pick(
              answers(request, 'catalog__places')[0],
              'places',
              'id',
              (place) => place.type === 'city' && place.countryCode === 'GB',
            ),
            checkIn: depart,
            checkOut: back,
            rooms: [{ adults: 1 }],
            sort: 'price',
            limit: 3,
          },
        },
        { name: 'cars__rentals', arguments: { city: 'London', pickupAt, returnAt, limit: 3 } },
      ],
    };
  }
  if (!called(request, 'hotels__prepare_booking')) {
    return {
      toolCalls: [
        {
          name: 'hotels__prepare_booking',
          arguments: { rateId: pick(answers(request, 'hotels__search')[0], 'hotels', 'rateId') },
        },
        {
          name: 'cars__prepare_booking',
          arguments: {
            carId: pick(answers(request, 'cars__rentals')[0], 'cars', 'carId'),
            pickupAt,
            returnAt,
          },
        },
      ],
    };
  }
  if (!called(request, 'trips__prepare_checkout')) {
    return { toolCalls: [{ name: 'trips__prepare_checkout', arguments: {} }] };
  }
  return { text: WHOLE_TRIP_ANSWER };
};
