import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import { DEFAULT_LOCALE } from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../infra/prisma.service';

import {
  cmsContentSchemas,
  pageContentSchema,
  type CmsBlockKey,
  type CmsContent,
  type contentPageSchema,
  type homeContentSchema,
  type siteContentSchema,
} from './content.schemas';
import { enabledPaymentProviders, paymentMethodsFor } from './payment-methods';

type SiteContentDto = z.infer<typeof siteContentSchema>;
type HomeContentDto = z.infer<typeof homeContentSchema>;
type ContentPageDto = z.infer<typeof contentPageSchema>;

interface Block {
  key: string;
  content: unknown;
  updatedAt: Date;
}

/**
 * Published CMS content for the web and mobile apps: site settings, homepage blocks, FAQs,
 * structured pages and verified trust signals. Drafts and unverified claims never leave the API.
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async site(locale: string): Promise<SiteContentDto> {
    const [blocks, pages, trustSignals] = await Promise.all([
      this.blocks({ in: ['site.contact', 'site.social', 'site.apps'] }, locale),
      this.blocks({ startsWith: 'page.' }, locale),
      // Guardrail: only verified signals, filtered in the query itself.
      this.prisma.trustSignal.findMany({
        where: { verified: true },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
        select: { key: true, label: true, value: true },
      }),
    ]);
    const contact = this.parse('site.contact', blocks.get('site.contact'));
    const social = this.parse('site.social', blocks.get('site.social'));
    const apps = this.parse('site.apps', blocks.get('site.apps'));
    return {
      contact: {
        phone: contact?.phone ?? null,
        whatsapp: contact?.whatsapp ?? null,
        email: contact?.email ?? null,
      },
      social: social?.links ?? [],
      apps: { iosUrl: apps?.iosUrl ?? null, androidUrl: apps?.androidUrl ?? null },
      pages: [...pages.values()]
        .map((block) => ({ slug: block.key.slice('page.'.length), page: this.parsePage(block) }))
        .filter((entry) => entry.page !== null)
        .map(({ slug, page }) => ({ slug, title: page?.title ?? slug, group: page?.group ?? '' }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
      trustSignals,
      paymentMethods: paymentMethodsFor(enabledPaymentProviders(this.config.PAYMENT_PROVIDERS)),
    };
  }

  async home(locale: string): Promise<HomeContentDto> {
    const [blocks, faqs] = await Promise.all([
      this.blocks({ in: ['home.hero', 'home.prime', 'home.why_book'] }, locale),
      this.faqs(locale),
    ]);
    const hero = this.parse('home.hero', blocks.get('home.hero'));
    const prime = this.parse('home.prime', blocks.get('home.prime'));
    const whyBook = this.parse('home.why_book', blocks.get('home.why_book'));
    return {
      hero: hero ? { headline: hero.headline, subheadline: hero.subheadline ?? null } : null,
      prime: prime
        ? {
            title: prime.title,
            benefits: prime.benefits,
            priceMonthly: prime.priceMonthly,
            priceYearly: prime.priceYearly,
          }
        : null,
      whyBook: whyBook
        ? { items: whyBook.items.map((item) => ({ ...item, body: item.body ?? null })) }
        : null,
      faqs,
    };
  }

  async page(slug: string, locale: string): Promise<ContentPageDto | null> {
    const block = (await this.blocks({ in: [`page.${slug}`] }, locale)).get(`page.${slug}`);
    const page = block ? this.parsePage(block) : null;
    if (!block || !page) return null;
    return {
      slug,
      title: page.title,
      group: page.group,
      sections: page.sections.map((section) => ({
        heading: section.heading ?? null,
        paragraphs: section.paragraphs,
      })),
      updatedAt: block.updatedAt.toISOString(),
    };
  }

  /** Published blocks for the locale, falling back to the default locale per key. */
  private async blocks(
    key: { in: string[] } | { startsWith: string },
    locale: string,
  ): Promise<Map<string, Block>> {
    const rows = await this.prisma.cmsBlock.findMany({
      where: {
        key,
        locale: { in: [...new Set([locale, DEFAULT_LOCALE])] },
        publishedAt: { lte: new Date() },
      },
      select: { key: true, locale: true, content: true, updatedAt: true },
    });
    const result = new Map<string, Block>();
    for (const row of rows) {
      if (!result.has(row.key) || row.locale === locale) result.set(row.key, row);
    }
    return result;
  }

  private async faqs(locale: string): Promise<HomeContentDto['faqs']> {
    const select = { id: true, question: true, answer: true } as const;
    const where = (value: string) => ({ locale: value, publishedAt: { lte: new Date() } });
    const orderBy = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
    const localised = await this.prisma.faq.findMany({ where: where(locale), select, orderBy });
    if (localised.length > 0 || locale === DEFAULT_LOCALE) return localised;
    return this.prisma.faq.findMany({ where: where(DEFAULT_LOCALE), select, orderBy });
  }

  private parse<K extends CmsBlockKey>(key: K, block: Block | undefined): CmsContent<K> | null {
    if (!block) return null;
    const result = cmsContentSchemas[key].safeParse(block.content);
    if (result.success) return result.data as CmsContent<K>;
    this.logger.warn({ key }, 'ignoring malformed CMS block');
    return null;
  }

  private parsePage(block: Block): z.infer<typeof pageContentSchema> | null {
    const result = pageContentSchema.safeParse(block.content);
    if (result.success) return result.data;
    this.logger.warn({ key: block.key }, 'ignoring malformed CMS page');
    return null;
  }
}
