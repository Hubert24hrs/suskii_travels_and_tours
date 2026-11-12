import { boardingWindow, type BusTicketStatus, type TicketClaims } from '@suskii/shared';

import type { TicketSigner } from '../ground/ticket-signer';

import type { BusItemPayload } from './inhouse-items';

/** A ticket as its owner sees it: the QR payload only while it can still board. */
export interface BusTicketView {
  id: string;
  seatNumber: string;
  passengerName: string;
  status: BusTicketStatus;
  boardedAt: Date | null;
  qrPayload: string | null;
  validFrom: Date;
  validUntil: Date;
}

interface TicketRow {
  id: string;
  tripId: string;
  seatNumber: string;
  passengerId: string;
  status: BusTicketStatus;
  boardedAt: Date | null;
}

/** What a ticket's QR code signs (ADR-050): ids, seat and the boarding window. */
export function ticketClaims(ticket: TicketRow, payload: BusItemPayload): TicketClaims {
  const { notBefore, notAfter } = boardingWindow(new Date(payload.departsAtUtc));
  return {
    tid: ticket.id,
    trp: ticket.tripId,
    st: ticket.seatNumber,
    nbf: Math.floor(notBefore.getTime() / 1000),
    exp: Math.floor(notAfter.getTime() / 1000),
  };
}

export function busTicketViews(
  tickets: readonly TicketRow[],
  passengers: readonly { id: string; givenNames: string; surname: string }[],
  payload: BusItemPayload,
  signer: TicketSigner,
): BusTicketView[] {
  const { notBefore, notAfter } = boardingWindow(new Date(payload.departsAtUtc));
  return [...tickets]
    .sort((a, b) => a.seatNumber.localeCompare(b.seatNumber, 'en', { numeric: true }))
    .map((ticket) => {
      const passenger = passengers.find((candidate) => candidate.id === ticket.passengerId);
      return {
        id: ticket.id,
        seatNumber: ticket.seatNumber,
        passengerName: passenger ? `${passenger.givenNames} ${passenger.surname}` : '',
        status: ticket.status,
        boardedAt: ticket.boardedAt,
        qrPayload: ticket.status === 'valid' ? signer.sign(ticketClaims(ticket, payload)) : null,
        validFrom: notBefore,
        validUntil: notAfter,
      };
    });
}
