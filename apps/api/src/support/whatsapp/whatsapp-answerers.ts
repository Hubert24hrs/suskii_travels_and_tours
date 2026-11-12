import { Injectable } from '@nestjs/common';

/** Something that may answer a traveller's WhatsApp message before a person does. */
export interface WhatsAppAnswerer {
  /**
   * Called after a traveller's text is stored in its support conversation. True when this
   * answerer takes the message (it answers in the background); false leaves it to the next.
   */
  take(conversationId: string): Promise<boolean>;
}

/**
 * Who answers WhatsApp messages automatically, in order. The support module owns the list and
 * knows nothing of who is on it: the assistant (ADR-101) registers itself from its own module,
 * so support never depends on it, and the after-hours assistant (ADR-085) answers when nobody
 * on the list takes the message.
 */
@Injectable()
export class WhatsAppAnswerers {
  private readonly answerers: WhatsAppAnswerer[] = [];

  register(answerer: WhatsAppAnswerer): void {
    this.answerers.push(answerer);
  }

  /** True when one of them took the message. One that fails is skipped, never fatal. */
  async take(conversationId: string): Promise<boolean> {
    for (const answerer of this.answerers) {
      try {
        if (await answerer.take(conversationId)) return true;
      } catch {
        // An answerer that cannot decide leaves the message to the next one.
      }
    }
    return false;
  }
}
