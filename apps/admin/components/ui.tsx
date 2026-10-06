'use client';

import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogTrigger,
  Input,
  type BadgeProps,
} from '@suskii/ui-web';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { problemMessage, problemOf } from '../lib/api';
import { t } from '../lib/i18n';

export function PageHeader({
  title,
  intro,
  actions,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{title}</h1>
        {intro ? <p className="font-body text-body-sm text-muted">{intro}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  intro,
  actions,
  children,
  className,
}: {
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={className}>
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1">
            <h2 id={headingId} className="font-heading text-h4 font-bold text-heading">
              {title}
            </h2>
            {intro ? <p className="font-body text-body-sm text-muted">{intro}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {children}
      </Card>
    </section>
  );
}

export interface Column<Row> {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  className?: string;
}

/** A plain, accessible table that scrolls sideways on small screens. */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  empty = t('common.empty'),
}: {
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  empty?: string;
}) {
  if (rows.length === 0) {
    return <p className="font-body text-body-sm text-muted">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse font-body text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn('px-3 py-2 font-bold text-heading', column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border align-top">
              {columns.map((column) => (
                <td key={column.key} className={cn('px-3 py-2 text-foreground', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Loading, permission and error states for a query; renders children with the data. */
export function QueryState<T>({
  query,
  children,
}: {
  query: { data: T | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <p role="status" className="font-body text-body-sm text-muted">
        {t('common.loading')}
      </p>
    );
  }
  if (query.error || query.data === undefined) {
    const { status } = problemOf(query.error);
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="font-body text-body-sm text-danger">
          {status === 403
            ? t('common.forbidden')
            : status === 404
              ? t('common.notFound')
              : problemMessage(query.error)}
        </p>
        {status !== 403 && status !== 404 ? (
          <Button variant="ghost" onClick={() => void query.refetch()}>
            {t('common.retry')}
          </Button>
        ) : null}
      </div>
    );
  }
  return <>{children(query.data)}</>;
}

/** The API's answer to a failed write: the problem and its field issues. */
export function ProblemAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const { issues } = problemOf(error);
  return (
    <div role="alert" className="flex flex-col gap-1 font-body text-body-sm text-danger">
      <p>{problemMessage(error)}</p>
      {issues.length > 0 ? (
        <ul className="list-disc pl-5">
          {issues.map((issue) => (
            <li key={`${issue.path}-${issue.message}`}>
              {t('common.fieldError', { field: issue.path || '-', message: issue.message })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: NonNullable<BadgeProps['variant']>;
  children: ReactNode;
}) {
  return <Badge variant={tone}>{children}</Badge>;
}

export { Input as TextField };

export function TextAreaField({
  label,
  hint,
  error,
  className,
  rows = 4,
  ...props
}: Omit<ComponentProps<'textarea'>, 'id'> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="font-body text-body-sm font-medium text-foreground">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className="w-full rounded-md border border-border-strong bg-surface p-3 font-body text-body text-foreground focus-visible:focus-ring aria-invalid:border-danger"
        {...props}
      />
      {hint ? (
        <span id={hintId} className="font-body text-caption text-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="font-body text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectField({
  label,
  options,
  error,
  className,
  ...props
}: Omit<ComponentProps<'select'>, 'id'> & {
  label: string;
  options: readonly SelectOption[];
  error?: string;
}) {
  const id = useId();
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="font-body text-body-sm font-medium text-foreground">
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className="h-12 w-full rounded-md border border-border-strong bg-surface px-3 font-body text-body text-foreground focus-visible:focus-ring aria-invalid:border-danger"
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error ? (
        <span id={errorId} className="font-body text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function CheckboxField({
  label,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { label: string }) {
  return (
    <label
      className={cn(
        'flex min-h-12 items-center gap-3 font-body text-body-sm text-foreground',
        className,
      )}
    >
      <input type="checkbox" className="size-5 shrink-0 accent-primary" {...props} />
      {label}
    </label>
  );
}

/** Label and value pairs (booking summary, user details). */
export function DetailList({ items }: { items: readonly { term: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {items.map((item) => (
        <div key={item.term} className="flex flex-col gap-1">
          <dt className="font-body text-caption font-bold text-muted">{item.term}</dt>
          <dd className="font-body text-body-sm text-foreground">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const FormGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
);

/** A button that opens a modal form; the caller closes it on success via `onOpenChange`. */
export function FormDialog({
  triggerLabel,
  triggerVariant = 'ghost',
  title,
  description,
  open,
  onOpenChange,
  children,
  testId,
  triggerAriaLabel,
}: {
  triggerLabel: string;
  triggerVariant?: 'primary' | 'secondary' | 'ghost';
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  testId?: string;
  /** A fuller name when several rows share the same trigger text. */
  triggerAriaLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} data-testid={testId} aria-label={triggerAriaLabel}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent title={title} description={description} closeLabel={t('common.close')}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** A destructive or account-changing action that asks first. */
export function ConfirmAction({
  triggerLabel,
  triggerAriaLabel,
  title,
  question,
  onConfirm,
  pending,
  error,
  open,
  onOpenChange,
}: {
  triggerLabel: string;
  triggerAriaLabel?: string;
  title?: string;
  question: string;
  onConfirm: () => void;
  pending: boolean;
  error: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <FormDialog
      triggerLabel={triggerLabel}
      triggerAriaLabel={triggerAriaLabel}
      title={title ?? triggerLabel}
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-4">
        <p className="font-body text-body-sm text-foreground">{question}</p>
        <ProblemAlert error={error} />
        <div className="flex gap-2">
          <Button loading={pending} onClick={onConfirm}>
            {t('common.yes')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
