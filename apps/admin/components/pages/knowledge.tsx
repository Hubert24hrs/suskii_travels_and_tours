'use client';

import {
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_LANGUAGES,
  KNOWLEDGE_TITLE_MAX,
  type KnowledgeAudience,
  type KnowledgeLanguage,
  type KnowledgeMediaType,
} from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, problemMessage, type Schemas } from '../../lib/api';
import { downloadFile } from '../../lib/download';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  ConfirmAction,
  DataTable,
  FormDialog,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  TextField,
} from '../ui';

type Doc = Schemas['KnowledgeDocument'];

const ROOT = '/v1/admin/ai/knowledge';

/** After a change: the lists, a document's passages and the search preview are all stale. */
const useRefresh = () => {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        typeof query.queryKey[1] === 'string' && query.queryKey[1].startsWith(ROOT),
    });
};

const kilobytes = (bytes: number) =>
  t('knowledge.kilobytes', { size: format.number(Math.max(1, Math.round(bytes / 1024))) });

/** The type by the file's name: browsers report Markdown differently, or not at all. */
function mediaTypeOf(name: string): KnowledgeMediaType | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  return null;
}

const audienceOptions = KNOWLEDGE_AUDIENCES.map((value) => ({
  value,
  label: label('knowledge.audiences', value),
}));
const languageOptions = KNOWLEDGE_LANGUAGES.map((value) => ({
  value,
  label: label('knowledge.languages', value),
}));

/**
 * Adds a document: the file's bytes are the request body, its title, audience and language go
 * beside it. The API checks that it is text, scans it and splits it into passages.
 */
function AddDialog({ maxBytes }: { maxBytes: number }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<KnowledgeAudience>('customer');
  const [language, setLanguage] = useState<KnowledgeLanguage>('en');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const limit = format.number(Math.floor(maxBytes / 1024));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!file) return setProblem(t('knowledge.fileMissing'));
    const mediaType = mediaTypeOf(file.name);
    if (!mediaType) return setProblem(t('knowledge.fileType'));
    if (file.size > maxBytes) return setProblem(t('knowledge.fileTooLarge', { size: limit }));
    setSending(true);
    try {
      const { data, error } = await adminApi.POST(ROOT, {
        params: { query: { title: title.trim(), audience, language } },
        body: file as unknown as string,
        bodySerializer: (body: unknown) => body as BodyInit,
        headers: { 'Content-Type': mediaType },
      });
      if (!data) return setProblem(problemMessage(error));
      setOpen(false);
      setFile(null);
      setTitle('');
      toast({
        title: t('knowledge.added', { count: format.number(data.passages) }),
        variant: 'success',
      });
      await refresh();
    } finally {
      setSending(false);
    }
  };
  return (
    <FormDialog
      triggerLabel={t('knowledge.add')}
      triggerVariant="primary"
      title={t('knowledge.add')}
      description={t('knowledge.addNote', { size: limit })}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setProblem(null);
      }}
      testId="add-knowledge"
    >
      <form method="post" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-body text-body-sm font-medium text-foreground">
          {t('knowledge.file')}
          <input
            type="file"
            accept=".txt,.md,.markdown,text/plain,text/markdown"
            data-testid="knowledge-file"
            className="min-h-12 font-body text-body-sm text-foreground"
            onChange={(event) => {
              const chosen = event.target.files?.[0] ?? null;
              setFile(chosen);
              // A title from the file's name saves typing; staff correct it before adding.
              if (chosen && !title.trim()) {
                setTitle(chosen.name.replace(/\.[^.]+$/, '').slice(0, KNOWLEDGE_TITLE_MAX));
              }
            }}
          />
        </label>
        <TextField
          label={t('knowledge.title_')}
          name="title"
          value={title}
          required
          minLength={3}
          maxLength={KNOWLEDGE_TITLE_MAX}
          hint={t('knowledge.titleHint')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <SelectField
          label={t('knowledge.audience')}
          name="audience"
          value={audience}
          options={audienceOptions}
          onChange={(event) => setAudience(event.target.value as KnowledgeAudience)}
        />
        <SelectField
          label={t('knowledge.language')}
          name="language"
          value={language}
          options={languageOptions}
          onChange={(event) => setLanguage(event.target.value as KnowledgeLanguage)}
        />
        {problem ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {problem}
          </p>
        ) : null}
        <Button type="submit" loading={sending}>
          {t('knowledge.addSubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

/** The passages of a document, as the assistant reads them. */
function PassagesDialog({ document }: { document: Doc }) {
  const [open, setOpen] = useState(false);
  const query = $api.useQuery(
    'get',
    `${ROOT}/{documentId}`,
    { params: { path: { documentId: document.id } } },
    { enabled: open },
  );
  return (
    <FormDialog
      triggerLabel={t('knowledge.view')}
      triggerAriaLabel={t('knowledge.viewLabel', { name: document.title })}
      title={t('knowledge.viewTitle', { name: document.title })}
      description={t('knowledge.viewNote')}
      open={open}
      onOpenChange={setOpen}
      testId={`passages-${document.id}`}
    >
      <QueryState query={query}>
        {(detail) => (
          <ol className="flex flex-col gap-3">
            {detail.passages.map((passage) => (
              <li
                key={passage.id}
                className="flex flex-col gap-1 rounded-md border border-border p-3"
              >
                <span className="font-body text-caption font-bold text-heading">
                  {passage.heading ?? t('knowledge.noHeading')}
                </span>
                <p className="font-body text-body-sm whitespace-pre-wrap text-foreground">
                  {passage.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </QueryState>
    </FormDialog>
  );
}

function EditDialog({ document }: { document: Doc }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(document.title);
  const [audience, setAudience] = useState<KnowledgeAudience>(document.audience);
  const { toast } = useToast();
  const refresh = useRefresh();
  const save = $api.useMutation('patch', `${ROOT}/{documentId}`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('knowledge.saved'), variant: 'success' });
      await refresh();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      params: { path: { documentId: document.id } },
      body: { title: title.trim(), audience },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('knowledge.edit')}
      triggerAriaLabel={t('knowledge.editLabel', { name: document.title })}
      title={t('knowledge.editTitle', { name: document.title })}
      description={t('knowledge.editNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTitle(document.title);
          setAudience(document.audience);
          save.reset();
        }
      }}
      testId={`edit-knowledge-${document.id}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('knowledge.title_')}
          name="title"
          value={title}
          required
          minLength={3}
          maxLength={KNOWLEDGE_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
        <SelectField
          label={t('knowledge.audience')}
          name="audience"
          value={audience}
          options={audienceOptions}
          onChange={(event) => setAudience(event.target.value as KnowledgeAudience)}
        />
        <ProblemAlert error={save.error} />
        <Button type="submit" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </FormDialog>
  );
}

/** Takes a document out of use, or puts it back. Nothing is ever deleted. */
function ArchiveAction({ document }: { document: Doc }) {
  const archived = document.archivedAt !== null;
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const change = $api.useMutation(
    'post',
    archived ? `${ROOT}/{documentId}/restore` : `${ROOT}/{documentId}/archive`,
    {
      onSuccess: async () => {
        setOpen(false);
        toast({
          title: archived ? t('knowledge.restoredToast') : t('knowledge.archivedToast'),
          variant: 'success',
        });
        await refresh();
      },
    },
  );
  const name = document.title;
  return (
    <ConfirmAction
      triggerLabel={archived ? t('knowledge.restore') : t('knowledge.archive')}
      triggerAriaLabel={
        archived ? t('knowledge.restoreLabel', { name }) : t('knowledge.archiveLabel', { name })
      }
      question={
        archived
          ? t('knowledge.restoreQuestion', { name })
          : t('knowledge.archiveQuestion', { name })
      }
      onConfirm={() => change.mutate({ params: { path: { documentId: document.id } } })}
      pending={change.isPending}
      error={change.error}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) change.reset();
      }}
    />
  );
}

function DownloadButton({ document }: { document: Doc }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const extension = document.mediaType === 'text/markdown' ? 'md' : 'txt';
  const save = async () => {
    setBusy(true);
    try {
      const done = await downloadFile(
        `${ROOT}/${document.id}/content`,
        `knowledge-${document.id}.${extension}`,
      );
      if (!done) toast({ title: t('knowledge.downloadFailed'), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="ghost"
      loading={busy}
      aria-label={t('knowledge.downloadLabel', { name: document.title })}
      onClick={() => void save()}
    >
      {t('knowledge.download')}
    </Button>
  );
}

function Documents({ manage }: { manage: boolean }) {
  const [archived, setArchived] = useState(false);
  const query = $api.useQuery('get', ROOT, {
    params: { query: { archived: archived ? 'true' : 'false' } },
  });
  return (
    <QueryState query={query}>
      {(list) => (
        <Section
          title={archived ? t('knowledge.archived') : t('knowledge.inUse')}
          intro={t('knowledge.usage', {
            count: format.number(list.inUse),
            limit: format.number(list.limit),
          })}
          actions={
            <>
              <Button variant="ghost" onClick={() => setArchived((current) => !current)}>
                {archived ? t('knowledge.inUse') : t('knowledge.archived')}
              </Button>
              {manage ? <AddDialog maxBytes={list.maxBytes} /> : null}
            </>
          }
        >
          <DataTable
            caption={t('knowledge.caption')}
            rows={list.items}
            rowKey={(row) => row.id}
            empty={archived ? t('knowledge.emptyArchived') : t('knowledge.empty')}
            columns={[
              {
                key: 'document',
                header: t('knowledge.document'),
                cell: (row) => (
                  <span className="flex flex-col gap-1">
                    <span className="font-bold text-heading">{row.title}</span>
                    <span className="text-muted">{label('knowledge.languages', row.language)}</span>
                  </span>
                ),
              },
              {
                key: 'audience',
                header: t('knowledge.audience'),
                cell: (row) => (
                  <StatusBadge tone={row.audience === 'staff' ? 'warning' : 'info'}>
                    {label('knowledge.audiences', row.audience)}
                  </StatusBadge>
                ),
              },
              {
                key: 'passages',
                header: t('knowledge.passages'),
                cell: (row) => format.number(row.passages),
              },
              { key: 'size', header: t('knowledge.size'), cell: (row) => kilobytes(row.sizeBytes) },
              {
                key: 'changed',
                header: t('knowledge.changed'),
                cell: (row) => format.dateTime(row.updatedAt),
              },
              {
                key: 'actions',
                header: t('common.actions'),
                cell: (row) => (
                  <span className="flex flex-wrap gap-2">
                    <PassagesDialog document={row} />
                    <DownloadButton document={row} />
                    {manage ? <EditDialog document={row} /> : null}
                    {manage ? <ArchiveAction document={row} /> : null}
                  </span>
                ),
              },
            ]}
          />
        </Section>
      )}
    </QueryState>
  );
}

/** The search the assistant runs, for staff to check what a question would be answered from. */
function TryQuestion() {
  const [draft, setDraft] = useState('');
  const [audience, setAudience] = useState<KnowledgeAudience>('customer');
  const [language, setLanguage] = useState<KnowledgeLanguage>('en');
  const [asked, setAsked] = useState<{
    q: string;
    audience: KnowledgeAudience;
    language: KnowledgeLanguage;
  } | null>(null);
  const query = $api.useQuery(
    'get',
    `${ROOT}/search`,
    { params: { query: asked ?? { q: '', audience, language } } },
    { enabled: asked !== null },
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = draft.trim();
    if (q.length < 2) return;
    // The same question asked again is searched again, not answered from what was shown.
    if (asked?.q === q && asked.audience === audience && asked.language === language) {
      void query.refetch();
    } else {
      setAsked({ q, audience, language });
    }
  };
  return (
    <Section title={t('knowledge.try')} intro={t('knowledge.tryIntro')}>
      <form method="get" onSubmit={submit} className="grid gap-3 md:grid-cols-4 md:items-end">
        <div className="md:col-span-2">
          <TextField
            label={t('knowledge.question')}
            name="q"
            value={draft}
            minLength={2}
            maxLength={200}
            required
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <SelectField
          label={t('knowledge.audience')}
          name="audience"
          value={audience}
          options={audienceOptions}
          onChange={(event) => setAudience(event.target.value as KnowledgeAudience)}
        />
        <SelectField
          label={t('knowledge.language')}
          name="language"
          value={language}
          options={languageOptions}
          onChange={(event) => setLanguage(event.target.value as KnowledgeLanguage)}
        />
        <Button type="submit" data-testid="try-knowledge">
          {t('knowledge.trySubmit')}
        </Button>
      </form>
      {asked ? (
        <QueryState query={query}>
          {(result) =>
            result.found === 0 ? (
              <p className="font-body text-body-sm text-muted" data-testid="knowledge-hits">
                {t('knowledge.nothingFound')}
              </p>
            ) : (
              <div className="flex flex-col gap-3" data-testid="knowledge-hits">
                <p className="font-body text-body-sm text-foreground">
                  {t('knowledge.found', { count: format.number(result.found) })}
                </p>
                <ol className="flex flex-col gap-3">
                  {result.hits.map((hit) => (
                    <li
                      key={hit.passageId}
                      className="flex flex-col gap-1 rounded-md border border-border p-3"
                    >
                      <span className="font-body text-caption font-bold text-heading">
                        {hit.heading
                          ? t('knowledge.from', { document: hit.document, section: hit.heading })
                          : hit.document}
                      </span>
                      <p className="font-body text-body-sm whitespace-pre-wrap text-foreground">
                        {hit.body}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            )
          }
        </QueryState>
      ) : null}
    </Section>
  );
}

/**
 * The knowledge base (ADR-105): the documents the assistant answers rules from. Reading needs
 * `ai:read`; adding, changing and archiving need `ai:manage` and are audited. A document is
 * company text: the page says, where staff choose a file, that nothing about a person belongs
 * in one.
 */
export function KnowledgePage() {
  const { can } = useStaffSession();
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader title={t('knowledge.title')} intro={t('knowledge.intro')} />
        <Documents manage={can('ai:manage')} />
        <TryQuestion />
      </div>
    </RequirePermission>
  );
}
