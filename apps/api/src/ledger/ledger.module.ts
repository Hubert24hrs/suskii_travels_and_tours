import { Global, Module } from '@nestjs/common';

import { LedgerService } from './ledger.service';
import { WalletController } from './wallet.controller';

/** Double-entry ledger (ADR-017), shared by payments, refunds and the wallet. */
@Global()
@Module({
  controllers: [WalletController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
