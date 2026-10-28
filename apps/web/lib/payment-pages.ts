/**
 * Pages that start a payment (PCI DSS SAQ A, ADR-089): checkout, the hosted-payment hand-off and
 * the booking page, which takes balances and installments. Only our own scripts and Turnstile run
 * there: no ad tags, and a policy that refuses any other script.
 */
const PAYMENT_PAGE = /^\/(?:checkout|bookings)(?:\/|$)/;

export const isPaymentPage = (pathname: string): boolean => PAYMENT_PAGE.test(pathname);
