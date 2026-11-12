import type { Messages } from '@suskii/i18n';

/** The Cars catalog subset client widgets need (plain module: server pages call it). */
export type CarsMessages = Record<'cars', Messages['cars']> &
  Record<'common', Pick<Messages['common'], 'close' | 'loading'>>;

export const pickCarsMessages = (messages: Messages): CarsMessages => ({
  cars: messages.cars,
  common: { close: messages.common.close, loading: messages.common.loading },
});
