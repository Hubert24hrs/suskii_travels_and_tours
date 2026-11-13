/**
 * How SUSKII T&T works, for the assistant (ADR-109): what a traveller can do on the website and
 * in the app, and where. It ships with the code, so it describes what this build does and no
 * more. It holds no price, fee, percentage, opening hour or promise: those come from the tools
 * that read the live records, or from the documents staff keep in the knowledge base.
 *
 * A change to a feature a traveller can see changes its topic here in the same change.
 */
export const PLATFORM_GUIDE_TOPICS = [
  'overview',
  'flights',
  'hotels',
  'cars',
  'packages_tours_visa',
  'combined_trips',
  'payments',
  'changes_and_refunds',
  'account_and_sign_in',
  'prime',
  'company_accounts',
  'support',
  'ask_suskii',
] as const;
export type PlatformGuideTopic = (typeof PLATFORM_GUIDE_TOPICS)[number];

interface GuideTopic {
  /** Plain sentences, one fact each. English: the assistant answers in the traveller's language. */
  guide: string[];
  /** Pages of the website (the app has the same screens) where this is done. */
  pages: { title: string; path: string }[];
}

export const PLATFORM_GUIDE: Readonly<Record<PlatformGuideTopic, GuideTopic>> = {
  overview: {
    guide: [
      'SUSKII T&T is one place to book travel: flights, hotels, intercity buses, rides, car rental, holiday packages, tours, visa assistance and travel extras such as insurance.',
      'It runs as a website and as a phone app for Android and iPhone; both show the same prices and the same bookings.',
      'A traveller can book as a guest with an email address, or sign in to keep trips, saved travellers and price alerts in one account. Rides, car rental and combined trips need an account.',
      'Every price shown is the full price to pay, with taxes and fees listed before payment.',
      'Parts of a trip can be booked one by one, or put together as one combined trip and paid once.',
      'Suskii Prime is the membership: members see member prices where a plan gives them.',
    ],
    pages: [
      { title: 'Home', path: '/' },
      { title: 'Deals', path: '/deals' },
    ],
  },
  flights: {
    guide: [
      'Flight search takes one way, return and multi city trips, a cabin class and up to 9 travellers: adults, children aged 2 to 11 and infants under 2 on a lap.',
      'A group of 10 or more is a group request: the traveller fills in a short form and the team answers with what the airline offers.',
      'Results can be sorted and filtered. "Flexible dates" shows the price on the days around the chosen date, and nearby airports are suggested under the results.',
      'Choosing a fare opens the booking page: traveller names as on the passport, contact details, then payment. The price is checked with the airline again just before payment; if it changed, the traveller is asked before anything is charged.',
      'Where the airline offers them, a checked bag can be added and seats can be chosen on the seat map at the booking page. Seats are charged at the airline’s price.',
      'Some airlines accept a special meal request; the booking page shows the choice only for those fares.',
      'Some fares can be reserved and paid later, or paid in installments. The booking page shows the schedule, any fee and what happens if a payment is missed before the traveller commits. Fares with paid bags or seats are paid in full.',
      'After payment the ticket is issued and the ticket is on the trip page and sent by email.',
      'A booked flight shows its live status close to departure, and the traveller is told about a delay or a cancellation.',
      'If the airline changes a booked flight, the trip page shows the change. The traveller can accept it. For a cancelled flight or a large change they can take a full refund with one tap.',
      'A ticketed flight can be cancelled from the trip page where the fare allows; the page shows what comes back before the traveller confirms.',
    ],
    pages: [
      { title: 'Flights', path: '/flights' },
      { title: 'Group requests', path: '/flights/groups' },
      { title: 'Manage a booking', path: '/manage-booking' },
    ],
  },
  hotels: {
    guide: [
      'Hotel search takes a city, check in and check out dates, and the rooms with their adults and children.',
      'Results can be filtered by price, stars, property type, meals, amenities and area, and shown as pins on a map view.',
      'Collections group stays: deals, family, luxury, honeymoon and long stay. A deal is a stay priced well below similar stays in the same search with a good guest score; it is a comparison, not a discount from an earlier price.',
      'A hotel page shows photos, a description, each room with what it includes, the meal plan, and whether it can be cancelled free and until when.',
      'Some rates include an amount paid at the property; that amount is shown apart from what is paid now.',
      'Reviews are from travellers whose booked stay has ended, and are checked before they are shown.',
      'The last hotel searches are kept on the device only, as "Continue your search".',
    ],
    pages: [{ title: 'Hotels', path: '/hotels' }],
  },
  cars: {
    guide: [
      'Ground transport has three products; each can be switched on or off, and the tool result says which are on now.',
      'Intercity buses: choose the route, the date and the number of seats, pick seats on the coach’s seat map, and pay. Each seat gets a QR boarding pass on the trip page, which also works offline in the app.',
      'Rides: a traveller who is signed in chooses a pickup and a drop off from the places served, a ride type, and now or later. The fare is shown before booking. The ride page shows the driver, a PIN to give the driver, the live trip, a way to share it and an SOS button.',
      'Car rental: a traveller who is signed in chooses a city or an airport branch and the pickup and return times. Rates are by the day, with lower rates for a week and a month where the car has them.',
      'A rental can be self drive or with a chauffeur where the car offers one. Extras, a return at another branch and cross border cover are chosen on the car’s page where the car offers them.',
      'A rental takes a refundable deposit, and the driver’s licence is checked before the car is handed over.',
    ],
    pages: [
      { title: 'Buses', path: '/buses' },
      { title: 'Rides', path: '/rides' },
      { title: 'Car rental', path: '/rentals' },
    ],
  },
  packages_tours_visa: {
    guide: [
      'Holiday packages and tours are sold by departure date with a limited number of places. The page shows what is included, the dates and the cancellation terms.',
      'A confirmed package or tour gives a voucher with a QR code on the trip page.',
      'Some packages can be paid with a deposit and installments; the schedule is shown before the traveller commits.',
      'Visa assistance: the visa page shows guidance on what a nationality needs for a destination. A traveller who buys assistance uploads documents securely and an officer reviews them. It is help with an application, never a guarantee of a visa.',
      'Travel extras such as insurance, an eSIM, lounge access or an airport transfer can be bought alone or added to a booking.',
      'Products marked "sample" are demonstration inventory, not real offers.',
    ],
    pages: [
      { title: 'Packages', path: '/packages' },
      { title: 'Tours', path: '/tours' },
      { title: 'Visa assistance', path: '/visa' },
      { title: 'Travel extras', path: '/travel-extras' },
    ],
  },
  combined_trips: {
    guide: [
      'A combined trip puts the parts of one journey together: a flight, a hotel, a rental car, an airport transfer and travel insurance, or only the parts the traveller wants.',
      'The traveller says where from, where to, the dates and who travels, then chooses each part from the ordinary search. The trip page shows a price per part and one total.',
      'The whole trip is paid once. Each part is still an ordinary booking with its own terms, and can be cancelled or changed on its own afterwards.',
      'A combined trip needs an account.',
      'Ask Suskii can put a combined trip together from the parts it prepared in the chat. The trip page then shows each prepared part with its price; the traveller enters each part’s details from there, then pays once.',
      'Packages, tours, visa assistance, eSIMs and lounge access are not parts of a combined trip: each is booked and paid on its own page.',
    ],
    pages: [{ title: 'Plan a trip', path: '/trips' }],
  },
  payments: {
    guide: [
      'Payment is made on a secure payment page of a payment provider, never in a chat, by phone or by message. Suskii never asks for card details, codes or passwords.',
      'The payment page lists the methods available for the currency, which can include card, bank transfer, USSD, mobile money, Apple Pay or Google Pay, and the Suskii wallet balance.',
      'A booking is confirmed only after the payment provider confirms the payment; the trip page then shows it as paid. A screenshot of a transfer is not a confirmation.',
      'Where a payment plan is offered, the booking page shows the deposit, each installment with its date, any fee and what happens when a payment is missed, before the traveller commits.',
      'The trip page shows what has been paid, what is still due, and the receipt.',
      'Prices can be shown in the currencies the site lists; the currency switch is at the top of the site and in the app’s settings.',
    ],
    pages: [{ title: 'Manage a booking', path: '/manage-booking' }],
  },
  changes_and_refunds: {
    guide: [
      'What can be changed or cancelled depends on the terms of the fare, rate or product, shown before booking and on the trip page.',
      'Where online cancellation is allowed, the trip page shows what comes back and what is kept before the traveller confirms.',
      'When an airline cancels a flight or changes it a lot, the trip page offers a full refund with one tap, or the traveller can accept the new flight.',
      'A refund goes back the way the payment came, or to the Suskii wallet where the traveller paid from it. The trip page shows each refund and its state.',
      'For anything the trip page does not offer, the support team handles the request.',
    ],
    pages: [
      { title: 'Manage a booking', path: '/manage-booking' },
      { title: 'Support', path: '/support' },
    ],
  },
  account_and_sign_in: {
    guide: [
      'Signing in works with an email and a password, a code texted to a mobile number, Google or Apple. In the app, fingerprint sign in can be turned on after the first sign in.',
      '"Remember me" keeps the sign in on the device. Unticked, the sign in ends when the browser or the app is closed and within a day at the latest.',
      'A forgotten password is reset from "Forgot password?" on the sign in card: a link is sent by email.',
      'An account keeps trips, saved travellers for faster booking, price alerts and notification settings. Two step verification with an authenticator app can be turned on.',
      'The account pages list the devices signed in and can sign any of them out.',
      'A traveller can download a copy of their data and delete their account from the privacy page; an account with an unfinished trip or an open payment cannot be deleted until it is settled.',
      'The site and the app are available in English, French, Swahili, Arabic and Portuguese.',
    ],
    pages: [
      { title: 'Sign in', path: '/sign in' },
      { title: 'Account', path: '/account' },
    ],
  },
  prime: {
    guide: [
      'Suskii Prime is a paid membership. The Prime page shows the plans on sale, their price for the traveller’s country and what each plan gives.',
      'A member sees member prices in search where the plan gives them, and some plans give priority with the support team.',
      'Prime is bought from the Prime page by a traveller who is signed in and lasts for the term shown there.',
    ],
    pages: [{ title: 'Suskii Prime', path: '/prime' }],
  },
  company_accounts: {
    guide: [
      'A company account lets an organisation book travel for its people: members have roles (admin, approver, booker, traveller).',
      'A company can set a travel policy, such as a cabin limit, a nightly hotel limit and how far ahead to book. A trip outside the policy can need an approver before it is paid.',
      'A company can keep a prepaid balance that its bookers pay from, and admins and approvers see spend reports.',
      'Company pages are under the account, for members of a company.',
    ],
    pages: [{ title: 'Company', path: '/account/company' }],
  },
  support: {
    guide: [
      'The support page opens a conversation with the team, about a booking or a general question. A guest can use it with an email address.',
      'Replies arrive in the same conversation, and the traveller is told by email or by a notification.',
      'The status page shows whether search, bookings, payments, accounts and support are working, with any open incident.',
      'Ask Suskii can bring in a person from the support team at any time when the traveller asks.',
    ],
    pages: [
      { title: 'Support', path: '/support' },
      { title: 'Status', path: '/status' },
    ],
  },
  ask_suskii: {
    guide: [
      'Ask Suskii is the assistant of SUSKII T&T, on the website and in the app.',
      'It answers questions about travelling with Suskii, searches flights, places to stay, buses, rental cars, packages and tours with the prices the traveller would pay, and explains the traveller’s own bookings when they are signed in.',
      'When the traveller has chosen an option, it prepares the booking: a card opens the booking page for that exact option, where the traveller enters the travellers’ details and pays on the secure payment page. It prepares flights, places to stay, rental cars, packages, tours, airport transfers, travel insurance, eSIMs, lounge access and visa assistance.',
      'For a bus trip it opens the seat map of the departure chosen, where the traveller picks the seats, enters the details and pays. It never holds a seat.',
      'When the traveller has what they want, it sums up every part it prepared with one total. For a signed in traveller with a flight, the flight, the stay, the car, the transfer and the insurance go on one combined trip that is paid once.',
      'It never takes payment, card details, passwords, codes or passport numbers in the chat, and it never says a booking is made until the records show it.',
      'For some actions on a booking, such as cancelling, accepting an airline’s change or taking a refund on offer, it shows a card and only the traveller’s tap carries the action out.',
      'It can watch a fare and tell the traveller when it drops, and it can remember a few travel preferences if the traveller agrees; they can see and erase them at any time.',
      'It hands over to a person from the support team when asked, or when it cannot help.',
    ],
    pages: [
      { title: 'Ask Suskii', path: '/assistant' },
      { title: 'What Ask Suskii remembers', path: '/assistant/preferences' },
    ],
  },
};
