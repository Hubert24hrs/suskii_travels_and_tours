/**
 * Pages that start a payment (PCI DSS SAQ A, ADR-089): checkout, the hosted-payment hand-off, the
 * booking page, which takes balances and installments, and a trip's page, which takes one
 * payment for all its parts (ADR-099; the trip plan form at `/trips` starts none). Only our own
 * scripts and Turnstile run there: no ad tags, and a policy that refuses any other script.
 */
const PAYMENT_PAGE = /^\/(?:checkout|bookings)(?:\/|$)|^\/trips\/./;

export const isPaymentPage = (pathname: string): boolean => PAYMENT_PAGE.test(pathname);
