import type { Messages } from '@suskii/i18n';

/** The catalog subset review widgets need on the client (plain module: servers call it). */
export type ReviewsMessages = Pick<Messages, 'reviews'>;

export const pickReviewsMessages = (messages: Messages): ReviewsMessages => ({
  reviews: messages.reviews,
});
