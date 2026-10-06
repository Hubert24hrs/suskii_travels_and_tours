'use client';

import { SUPPORTED_LOCALES, type LocaleCode } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { fieldIssues } from '../../lib/form';
import { format, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import {
  CheckboxField,
  DataTable,
  FormDialog,
  FormGrid,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../ui';

type Block = Schemas['AdminCmsBlock'];
type Faq = Schemas['AdminFaq'];

const localeOptions = SUPPORTED_LOCALES.map((locale) => ({ value: locale, label: locale }));
const NEW_PAGE = '__page__';
const PAGE_TEMPLATE = {
  title: '',
  group: 'company',
  sections: [{ heading: null, paragraphs: [''] }],
};

const published = (on: boolean) => (
  <StatusBadge tone={on ? 'success' : 'neutral'}>
    {on ? t('common.published') : t('common.unpublished')}
  </StatusBadge>
);

/** Edits one block (or starts a new one) as JSON; the API checks it against the site's schema. */
function BlockDialog({ block, fixedKeys }: { block: Block | null; fixedKeys: string[] }) {
  const [open, setOpen] = useState(false);
  const [keyChoice, setKeyChoice] = useState(block?.key ?? NEW_PAGE);
  const [slug, setSlug] = useState('');
  const [locale, setLocale] = useState<LocaleCode>(block?.locale ?? 'en-NG');
  const [json, setJson] = useState(JSON.stringify(block?.content ?? PAGE_TEMPLATE, null, 2));
  const [isPublished, setPublished] = useState(block?.published ?? false);
  const [jsonError, setJsonError] = useState<string | undefined>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const save = $api.useMutation('put', '/v1/admin/content/blocks/{locale}/{key}', {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('common.saved'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/content/blocks'] });
    },
  });
  const key = block?.key ?? (keyChoice === NEW_PAGE ? `page.${slug.trim()}` : keyChoice);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    let content: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(json);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      content = parsed as Record<string, unknown>;
      setJsonError(undefined);
    } catch {
      setJsonError(t('validation.json'));
      return;
    }
    save.mutate({ params: { path: { locale, key } }, body: { content, published: isPublished } });
  };
  const title = block
    ? t('content.editBlock', { key: block.key, locale: block.locale })
    : t('content.newPage');
  return (
    <FormDialog
      triggerLabel={block ? t('common.edit') : t('content.newPage')}
      triggerVariant={block ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) save.reset();
      }}
      testId={block ? `edit-block-${block.key}-${block.locale}` : 'new-block'}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {block ? null : (
          <FormGrid>
            <SelectField
              label={t('content.key')}
              name="key"
              value={keyChoice}
              options={[
                { value: NEW_PAGE, label: t('content.newPage') },
                ...fixedKeys.map((fixed) => ({ value: fixed, label: fixed })),
              ]}
              onChange={(event) => setKeyChoice(event.target.value)}
            />
            <SelectField
              label={t('content.locale')}
              name="locale"
              value={locale}
              options={localeOptions}
              onChange={(event) => setLocale(event.target.value as LocaleCode)}
            />
            {keyChoice === NEW_PAGE ? (
              <TextField
                label={t('content.pageSlug')}
                hint={t('deals.slugHint')}
                name="slug"
                value={slug}
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={40}
                onChange={(event) => setSlug(event.target.value)}
              />
            ) : null}
          </FormGrid>
        )}
        <TextAreaField
          label={t('content.contentJson')}
          hint={t('content.contentHint')}
          name="content"
          rows={14}
          spellCheck={false}
          value={json}
          error={jsonError}
          onChange={(event) => setJson(event.target.value)}
          data-testid="block-json"
        />
        <CheckboxField
          label={t('content.publish')}
          name="published"
          checked={isPublished}
          onChange={(event) => setPublished(event.target.checked)}
        />
        <ProblemAlert error={save.error} />
        <Button type="submit" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Blocks() {
  const [locale, setLocale] = useState<LocaleCode | ''>('');
  const query = $api.useQuery('get', '/v1/admin/content/blocks', {
    params: { query: locale ? { locale } : {} },
  });
  return (
    <Section
      title={t('content.blocks')}
      intro={t('content.blocksIntro')}
      actions={<BlockDialog block={null} fixedKeys={query.data?.fixedKeys ?? []} />}
    >
      <div className="max-w-popover">
        <SelectField
          label={t('content.locale')}
          name="blockLocale"
          value={locale}
          options={[{ value: '', label: t('common.all') }, ...localeOptions]}
          onChange={(event) => setLocale(event.target.value as LocaleCode | '')}
        />
      </div>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('content.blocks')}
            rows={data.blocks}
            rowKey={(row) => `${row.key}-${row.locale}`}
            columns={[
              { key: 'key', header: t('content.key'), cell: (row) => <code>{row.key}</code> },
              { key: 'locale', header: t('content.locale'), cell: (row) => row.locale },
              {
                key: 'published',
                header: t('common.status'),
                cell: (row) => published(row.published),
              },
              {
                key: 'valid',
                header: t('content.valid'),
                cell: (row) =>
                  row.valid ? (
                    t('common.yes')
                  ) : (
                    <StatusBadge tone="danger">{t('content.invalid')}</StatusBadge>
                  ),
              },
              {
                key: 'updated',
                header: t('common.updated'),
                cell: (row) => format.dateTime(row.updatedAt),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <BlockDialog block={row} fixedKeys={data.fixedKeys} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

function FaqDialog({ faq }: { faq: Faq | null }) {
  const blank = {
    locale: faq?.locale ?? 'en-NG',
    question: faq?.question ?? '',
    answer: faq?.answer ?? '',
    sortOrder: String(faq?.sortOrder ?? 0),
    published: faq?.published ?? false,
  };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const onSuccess = async () => {
    setOpen(false);
    toast({ title: t('common.saved'), variant: 'success' });
    await queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/content/faqs'] });
  };
  const create = $api.useMutation('post', '/v1/admin/content/faqs', { onSuccess });
  const update = $api.useMutation('patch', '/v1/admin/content/faqs/{id}', { onSuccess });
  const mutation = faq ? update : create;
  const errors = fieldIssues(mutation.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const body = { ...form, sortOrder: Number(form.sortOrder) };
    if (faq) update.mutate({ params: { path: { id: faq.id } }, body });
    else create.mutate({ body });
  };
  const title = faq ? t('content.editFaq') : t('content.newFaq');
  return (
    <FormDialog
      triggerLabel={faq ? t('common.edit') : title}
      triggerVariant={faq ? 'ghost' : 'primary'}
      title={title}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(blank);
          mutation.reset();
        }
      }}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormGrid>
          <SelectField
            label={t('content.locale')}
            name="locale"
            value={form.locale}
            options={localeOptions}
            onChange={(event) => setForm({ ...form, locale: event.target.value as LocaleCode })}
          />
          <TextField
            label={t('content.sortOrder')}
            name="sortOrder"
            type="number"
            min={0}
            max={10000}
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
          />
        </FormGrid>
        <TextField
          label={t('content.question')}
          name="question"
          value={form.question}
          required
          maxLength={300}
          error={errors.question}
          onChange={(event) => setForm({ ...form, question: event.target.value })}
        />
        <TextAreaField
          label={t('content.answer')}
          name="answer"
          value={form.answer}
          required
          maxLength={4000}
          rows={6}
          error={errors.answer}
          onChange={(event) => setForm({ ...form, answer: event.target.value })}
        />
        <CheckboxField
          label={t('content.publish')}
          name="published"
          checked={form.published}
          onChange={(event) => setForm({ ...form, published: event.target.checked })}
        />
        <ProblemAlert error={mutation.error} />
        <Button type="submit" loading={mutation.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

function Faqs() {
  const query = $api.useQuery('get', '/v1/admin/content/faqs', {});
  return (
    <Section title={t('content.faqs')} actions={<FaqDialog faq={null} />}>
      <QueryState query={query}>
        {(data) => (
          <DataTable
            caption={t('content.faqs')}
            rows={data.faqs}
            rowKey={(row) => row.id}
            columns={[
              { key: 'question', header: t('content.question'), cell: (row) => row.question },
              { key: 'locale', header: t('content.locale'), cell: (row) => row.locale },
              { key: 'order', header: t('content.sortOrder'), cell: (row) => row.sortOrder },
              {
                key: 'published',
                header: t('common.status'),
                cell: (row) => published(row.published),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => <FaqDialog faq={row} />,
              },
            ]}
          />
        )}
      </QueryState>
    </Section>
  );
}

export function ContentPage() {
  return (
    <RequirePermission permission="cms:manage">
      <PageHeader title={t('content.title')} />
      <Blocks />
      <Faqs />
    </RequirePermission>
  );
}
