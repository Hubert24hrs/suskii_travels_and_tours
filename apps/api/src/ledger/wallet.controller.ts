import { Controller, Get } from '@nestjs/common';
import { z } from 'zod';

import { money, toWire } from '@suskii/shared';

import { CurrentAuth, type AuthContext } from '../auth/auth-context';
import { Contract, named } from '../contract/contract';
import { moneySchema } from '../pricing/pricing.schemas';

import { LEDGER_KINDS } from './ledger-accounts';
import { LedgerService } from './ledger.service';

export const walletSchema = named(
  'Wallet',
  z.object({
    balances: z.array(moneySchema).meta({ description: 'One balance per currency ever used.' }),
    movements: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(LEDGER_KINDS),
        /** Positive when money came into the wallet. */
        amount: moneySchema,
        bookingId: z.uuid().nullable(),
        occurredAt: z.iso.datetime(),
      }),
    ),
  }),
);

/** The signed-in customer's wallet (ADR-017): balances and latest movements. */
@Controller('me/wallet')
export class WalletController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @Contract({
    operationId: 'getWallet',
    summary: 'Wallet balances and latest movements',
    tags: ['Wallet'],
    responses: { 200: walletSchema },
  })
  async wallet(@CurrentAuth() auth: AuthContext): Promise<z.infer<typeof walletSchema>> {
    const { accounts, entries } = await this.ledger.wallet(auth.userId);
    return {
      balances: accounts.map((account) => toWire(money(account.balanceMinor, account.currency))),
      movements: entries.map((entry) => ({
        id: entry.id,
        kind: entry.transaction.kind as (typeof LEDGER_KINDS)[number],
        // Wallets are liabilities: a credit is money in for the customer.
        amount: toWire(
          money(
            entry.direction === 'credit' ? entry.amountMinor : -entry.amountMinor,
            entry.currency,
          ),
        ),
        bookingId: entry.transaction.bookingId,
        occurredAt: entry.createdAt.toISOString(),
      })),
    };
  }
}
