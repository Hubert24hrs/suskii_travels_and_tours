'use client';

import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, problemMessage, problemOf, type Schemas } from '../../lib/api';
import { shareOf, usdFineFromMicro, usdFromMicro } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  DataTable,
  DetailList,
  FormDialog,
  PageHeader,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  type Column,
} from '../ui';

type Cost = Schemas['AdminAgentCost'];
type Quality = Schemas['AdminAgentQuality'];
type Limits = Schemas['AdminAgentLimits'];
type Evals = Schemas['AdminAgentEvals'];
type Eval = Schemas['AdminAgentEval'];

const EVALS = '/v1/admin/ai/evals';
/** A result file is a few hundred bytes; anything much larger is another file. */
const EVAL_FILE_MAX_BYTES = 64 * 1024;

const PERIODS = [7, 30, 90] as const;
type Period = (typeof PERIODS)[number];

/** What a row of spend holds, whatever it is grouped by. */
interface Spend {
  runs: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicroUsd: number;
}

function spendColumns<Row extends Spend>(
  first: Column<Row>,
  withTokens: boolean,
): readonly Column<Row>[] {
  return [
    first,
    { key: 'runs', header: t('aiInsights.runs'), cell: (row) => format.number(row.runs) },
    ...(withTokens
      ? [
          {
            key: 'in',
            header: t('aiInsights.tokensIn'),
            cell: (row: Row) => format.number(row.inputTokens ?? 0),
          },
          {
            key: 'out',
            header: t('aiInsights.tokensOut'),
            cell: (row: Row) => format.number(row.outputTokens ?? 0),
          },
        ]
      : []),
    {
      key: 'cost',
      header: t('aiInsights.estimated'),
      cell: (row) => usdFineFromMicro(row.costMicroUsd),
    },
  ];
}

function CostSection({ cost }: { cost: Cost }) {
  const none = t('aiInsights.noSpend');
  return (
    <Section
      title={t('aiInsights.cost')}
      intro={t('aiInsights.costIntro', {
        from: format.date(cost.from),
        to: format.date(cost.to),
      })}
      actions={<StatusBadge tone="warning">{t('aiInsights.estimate')}</StatusBadge>}
    >
      <div data-testid="cost-total">
        <DetailList
          items={[
            { term: t('aiInsights.estimated'), value: usdFineFromMicro(cost.total.costMicroUsd) },
            { term: t('aiInsights.runs'), value: format.number(cost.total.runs) },
            { term: t('aiInsights.tokensIn'), value: format.number(cost.total.inputTokens) },
            { term: t('aiInsights.tokensOut'), value: format.number(cost.total.outputTokens) },
            { term: t('aiInsights.monthToDate'), value: usdFromMicro(cost.month.toDateMicroUsd) },
            {
              term: t('aiInsights.monthForecast'),
              value: (
                <span className="flex flex-col gap-1">
                  <span>{usdFromMicro(cost.month.forecastMicroUsd)}</span>
                  <span className="text-muted">
                    {t('aiInsights.monthForecastNote', {
                      day: format.number(cost.month.daysElapsed),
                      days: format.number(cost.month.daysInMonth),
                    })}
                  </span>
                </span>
              ),
            },
            { term: t('aiInsights.capGlobal'), value: usdFromMicro(cost.caps.globalDailyMicroUsd) },
            { term: t('aiInsights.capUser'), value: usdFromMicro(cost.caps.userDailyMicroUsd) },
            { term: t('aiInsights.capGuest'), value: usdFromMicro(cost.caps.guestDailyMicroUsd) },
          ]}
        />
      </div>
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.byAgent')}</h3>
      <DataTable
        caption={t('aiInsights.byAgent')}
        rows={cost.byAgent}
        rowKey={(row) => row.agent}
        empty={none}
        columns={spendColumns<Cost['byAgent'][number]>(
          {
            key: 'agent',
            header: t('aiInsights.agent'),
            cell: (row) => label('ai.agents', row.agent),
          },
          true,
        )}
      />
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.byModel')}</h3>
      <DataTable
        caption={t('aiInsights.byModel')}
        rows={cost.byModel}
        rowKey={(row) => row.model}
        empty={none}
        columns={spendColumns<Cost['byModel'][number]>(
          { key: 'model', header: t('aiInsights.model'), cell: (row) => <code>{row.model}</code> },
          true,
        )}
      />
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.byChannel')}</h3>
      <DataTable
        caption={t('aiInsights.byChannel')}
        rows={cost.byChannel}
        rowKey={(row) => `${row.channel}-${row.audience}`}
        empty={none}
        columns={spendColumns<Cost['byChannel'][number]>(
          {
            key: 'channel',
            header: t('aiInsights.channel'),
            cell: (row) => (
              <span className="flex flex-col gap-1">
                <span>{label('aiActivity.channels', row.channel)}</span>
                <span className="text-muted">{label('ai.audiences', row.audience)}</span>
              </span>
            ),
          },
          false,
        )}
      />
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.byDay')}</h3>
      <DataTable
        caption={t('aiInsights.byDay')}
        rows={cost.byDay}
        rowKey={(row) => row.day}
        empty={none}
        columns={spendColumns<Cost['byDay'][number]>(
          { key: 'day', header: t('aiInsights.day'), cell: (row) => format.date(row.day) },
          false,
        )}
      />
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.topAccounts')}</h3>
      <p className="font-body text-body-sm text-muted">{t('aiInsights.topAccountsNote')}</p>
      <DataTable
        caption={t('aiInsights.topAccounts')}
        rows={cost.topAccounts}
        rowKey={(row) => row.userId}
        empty={none}
        columns={spendColumns<Cost['topAccounts'][number]>(
          {
            key: 'account',
            header: t('aiInsights.account'),
            cell: (row) => <code className="break-all">{row.userId}</code>,
          },
          false,
        )}
      />
    </Section>
  );
}

function QualitySection({ quality }: { quality: Quality }) {
  const of = (count: number) =>
    t('aiInsights.share', { count: format.number(count), percent: shareOf(count, quality.runs) });
  const rated = quality.feedback.up + quality.feedback.down;
  return (
    <Section
      title={t('aiInsights.quality')}
      intro={t('aiInsights.qualityIntro', {
        from: format.date(quality.from),
        to: format.date(quality.to),
      })}
    >
      <div data-testid="quality-total">
        <DetailList
          items={[
            { term: t('aiInsights.runs'), value: format.number(quality.runs) },
            { term: t('aiInsights.answered'), value: of(quality.answered) },
            { term: t('aiInsights.handovers'), value: of(quality.handovers) },
            { term: t('aiInsights.guardBlocked'), value: of(quality.guardBlocked) },
            { term: t('aiInsights.failed'), value: of(quality.failed) },
            {
              term: t('aiInsights.helpful'),
              value: t('aiInsights.share', {
                count: format.number(quality.feedback.up),
                percent: shareOf(quality.feedback.up, rated),
              }),
            },
            {
              term: t('aiInsights.unhelpful'),
              value: t('aiInsights.share', {
                count: format.number(quality.feedback.down),
                percent: shareOf(quality.feedback.down, rated),
              }),
            },
            {
              term: t('aiInsights.rating'),
              value:
                quality.ratings.averageTenths === null
                  ? t('aiInsights.notRated')
                  : t('aiInsights.ratingValue', {
                      average: format.number(quality.ratings.averageTenths / 10),
                      count: format.number(quality.ratings.rated),
                    }),
            },
          ]}
        />
      </div>
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.funnel')}</h3>
      <p className="font-body text-body-sm text-muted">{t('aiInsights.funnelIntro')}</p>
      <div data-testid="quality-funnel">
        <DetailList
          items={(
            [
              ['conversations', quality.funnel.conversations],
              ['answered', quality.funnel.answered],
              ['searched', quality.funnel.searched],
              ['askedForAPrice', quality.funnel.askedForAPrice],
              ['askedToConfirm', quality.funnel.askedToConfirm],
              ['confirmed', quality.funnel.confirmed],
              ['handedOver', quality.funnel.handedOver],
            ] as const
          ).map(([step, count]) => ({
            term: t(`aiInsights.funnelSteps.${step}`),
            value:
              step === 'conversations'
                ? format.number(count)
                : t('aiInsights.share', {
                    count: format.number(count),
                    percent: shareOf(count, quality.funnel.conversations),
                  }),
          }))}
        />
      </div>
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.prompts')}</h3>
      <DataTable
        caption={t('aiInsights.prompts')}
        rows={quality.prompts}
        rowKey={(row) => row.promptVersion}
        empty={t('aiInsights.noRuns')}
        columns={[
          {
            key: 'prompt',
            header: t('aiInsights.promptVersion'),
            cell: (row) => <code className="break-all">{row.promptVersion}</code>,
          },
          { key: 'runs', header: t('aiInsights.runs'), cell: (row) => format.number(row.runs) },
          {
            key: 'answered',
            header: t('aiInsights.answered'),
            cell: (row) =>
              t('aiInsights.share', {
                count: format.number(row.answered),
                percent: shareOf(row.answered, row.runs),
              }),
          },
          {
            key: 'guard',
            header: t('aiInsights.guardBlocked'),
            cell: (row) => format.number(row.guardBlocked),
          },
          { key: 'up', header: t('aiInsights.helpful'), cell: (row) => format.number(row.up) },
          {
            key: 'down',
            header: t('aiInsights.unhelpful'),
            cell: (row) => format.number(row.down),
          },
        ]}
      />
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.shadow')}</h3>
      <p className="font-body text-body-sm text-muted">{t('aiInsights.shadowIntro')}</p>
      <div data-testid="quality-shadow" className="flex flex-col gap-3">
        <DetailList
          items={[
            {
              term: t('aiInsights.shadowCandidates'),
              value:
                quality.shadow.candidates.length > 0 ? (
                  <code className="break-all">{quality.shadow.candidates.join(', ')}</code>
                ) : (
                  t('aiInsights.shadowNone')
                ),
            },
            {
              term: t('aiInsights.shadowSample'),
              value: t('aiInsights.percentOfTurns', {
                percent: format.number(quality.shadow.samplePercent),
              }),
            },
            {
              term: t('aiInsights.shadowSpend'),
              value: t('aiInsights.ofCap', {
                spent: usdFineFromMicro(quality.shadow.spentTodayMicroUsd),
                cap: usdFromMicro(quality.shadow.dailyCapMicroUsd),
              }),
            },
          ]}
        />
        <DataTable
          caption={t('aiInsights.shadow')}
          rows={quality.shadow.prompts}
          rowKey={(row) => row.prompt}
          empty={t('aiInsights.shadowEmpty')}
          columns={[
            {
              key: 'prompt',
              header: t('aiInsights.shadowCandidate'),
              cell: (row) => <code className="break-all">{row.prompt}</code>,
            },
            {
              key: 'compared',
              header: t('aiInsights.shadowCompared'),
              cell: (row) =>
                t('aiInsights.ofTurns', {
                  count: format.number(row.compared),
                  turns: format.number(row.turns),
                }),
            },
            {
              key: 'answered',
              header: t('aiInsights.shadowAnswered'),
              cell: (row) =>
                t('aiInsights.share', {
                  count: format.number(row.answered),
                  percent: shareOf(row.answered, row.compared),
                }),
            },
            {
              key: 'guard',
              header: t('aiInsights.guardBlocked'),
              cell: (row) => format.number(row.guardBlocked),
            },
            {
              key: 'agent',
              header: t('aiInsights.shadowSameAgent'),
              cell: (row) =>
                t('aiInsights.share', {
                  count: format.number(row.sameAgent),
                  percent: shareOf(row.sameAgent, row.compared),
                }),
            },
            {
              key: 'missed',
              header: t('aiInsights.shadowMissed'),
              cell: (row) =>
                t('aiInsights.ofCalls', {
                  count: format.number(row.missedCalls),
                  calls: format.number(row.missedCalls + row.replayedCalls),
                }),
            },
            {
              key: 'cost',
              header: t('aiInsights.cost'),
              cell: (row) => usdFineFromMicro(row.costMicroUsd),
            },
          ]}
        />
      </div>
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.outcomes')}</h3>
      <DataTable
        caption={t('aiInsights.outcomes')}
        rows={quality.outcomes}
        rowKey={(row) => row.outcome}
        empty={t('aiInsights.noRuns')}
        columns={[
          {
            key: 'outcome',
            header: t('aiInsights.outcome'),
            cell: (row) => <code>{row.outcome}</code>,
          },
          { key: 'runs', header: t('aiInsights.runs'), cell: (row) => of(row.runs) },
        ]}
      />
    </Section>
  );
}

function LimitsSection({ limits }: { limits: Limits }) {
  return (
    <Section title={t('aiInsights.limits')} intro={t('aiInsights.limitsIntro')}>
      <DetailList
        items={[
          { term: t('aiInsights.runMaxSteps'), value: format.number(limits.runMaxSteps) },
          { term: t('aiInsights.runMaxToolCalls'), value: format.number(limits.runMaxToolCalls) },
          {
            term: t('aiInsights.runTimeout'),
            value: t('aiActivity.seconds', {
              seconds: format.number(Math.round(limits.runTimeoutMs / 1000)),
            }),
          },
          {
            term: t('aiInsights.grantTtl'),
            value: t('aiActivity.seconds', { seconds: format.number(limits.grantTtlSeconds) }),
          },
          { term: t('aiInsights.maxOutputTokens'), value: format.number(limits.maxOutputTokens) },
          { term: t('aiInsights.runReserve'), value: usdFineFromMicro(limits.runReserveMicroUsd) },
          { term: t('aiInsights.capGlobal'), value: usdFromMicro(limits.globalDailyMicroUsd) },
          { term: t('aiInsights.capUser'), value: usdFromMicro(limits.userDailyMicroUsd) },
          { term: t('aiInsights.capGuest'), value: usdFromMicro(limits.guestDailyMicroUsd) },
          {
            term: t('aiInsights.monthlyAlert'),
            value:
              limits.monthlyAlertMicroUsd > 0
                ? usdFromMicro(limits.monthlyAlertMicroUsd)
                : t('aiInsights.monthlyAlertNone'),
          },
          {
            term: t('aiInsights.shadowSample'),
            value: t('aiInsights.percentOfTurns', {
              percent: format.number(limits.shadowSamplePercent),
            }),
          },
          { term: t('aiInsights.capShadow'), value: usdFromMicro(limits.shadowDailyMicroUsd) },
          {
            term: t('aiInsights.confirmationMinutes'),
            value: t('aiInsights.minutes', { count: format.number(limits.confirmationMinutes) }),
          },
          {
            term: t('aiInsights.approvalDays'),
            value: t('aiInsights.days', { count: format.number(limits.approvalDays) }),
          },
          {
            term: t('aiInsights.messageMax'),
            value: t('aiInsights.characters', { count: format.number(limits.messageMax) }),
          },
          {
            term: t('aiInsights.conversationMessageLimit'),
            value: format.number(limits.conversationMessageLimit),
          },
        ]}
      />
      <h3 className="font-heading text-h5 font-bold text-heading">{t('aiInsights.prices')}</h3>
      <p className="font-body text-body-sm text-muted">{t('aiInsights.pricesIntro')}</p>
      <DataTable
        caption={t('aiInsights.prices')}
        rows={limits.models}
        rowKey={(row) => row.model}
        empty={t('aiInsights.noPrices')}
        columns={[
          { key: 'model', header: t('aiInsights.model'), cell: (row) => <code>{row.model}</code> },
          {
            key: 'in',
            header: t('aiInsights.priceIn'),
            cell: (row) => usdFromMicro(row.inputPerMillion),
          },
          {
            key: 'out',
            header: t('aiInsights.priceOut'),
            cell: (row) => usdFromMicro(row.outputPerMillion),
          },
          {
            key: 'cacheRead',
            header: t('aiInsights.priceCacheRead'),
            cell: (row) => usdFromMicro(row.cacheReadPerMillion),
          },
          {
            key: 'cacheWrite',
            header: t('aiInsights.priceCacheWrite'),
            cell: (row) => usdFromMicro(row.cacheWritePerMillion),
          },
        ]}
      />
    </Section>
  );
}

/**
 * Records one run of an eval: the file the eval command wrote with `--json` is the request
 * body, as it is. The API decides whether it is a result; the page only checks that it is
 * JSON and small.
 */
function RecordEvalDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    if (!file) return setProblem(t('aiInsights.evalFileMissing'));
    if (file.size > EVAL_FILE_MAX_BYTES) return setProblem(t('aiInsights.evalNotResult'));
    let body: Schemas['AdminAgentEvalInputInput'];
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      body = parsed as Schemas['AdminAgentEvalInputInput'];
    } catch {
      return setProblem(t('aiInsights.evalNotResult'));
    }
    setSending(true);
    try {
      const { data, error } = await adminApi.POST(EVALS, { body });
      if (!data) {
        // A file that is JSON but not a result is refused field by field; one sentence says so.
        return setProblem(
          problemOf(error).status === 400 ? t('aiInsights.evalNotResult') : problemMessage(error),
        );
      }
      setOpen(false);
      setFile(null);
      toast({ title: t('aiInsights.evalRecorded'), variant: 'success' });
      await queryClient.invalidateQueries({ queryKey: ['get', EVALS] });
    } finally {
      setSending(false);
    }
  };
  return (
    <FormDialog
      triggerLabel={t('aiInsights.evalRecord')}
      triggerVariant="secondary"
      title={t('aiInsights.evalRecord')}
      description={t('aiInsights.evalRecordNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setProblem(null);
      }}
      testId="record-eval"
    >
      <form method="post" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 font-body text-body-sm font-medium text-foreground">
          {t('aiInsights.evalFile')}
          <input
            type="file"
            accept=".json,application/json"
            data-testid="eval-file"
            className="min-h-12 font-body text-body-sm text-foreground"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>
        {problem ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {problem}
          </p>
        ) : null}
        <Button type="submit" loading={sending}>
          {t('aiInsights.evalRecordSubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

const evalColumns: readonly Column<Eval>[] = [
  {
    key: 'suite',
    header: t('aiInsights.evalSuite'),
    cell: (row) => label('aiInsights.evalSuites', row.suite),
  },
  {
    key: 'against',
    header: t('aiInsights.evalAgainst'),
    cell: (row) =>
      row.models.length > 0 ? (
        <code className="break-all">{row.models.join(', ')}</code>
      ) : (
        label('aiInsights.evalModes', row.mode)
      ),
  },
  {
    key: 'result',
    header: t('aiInsights.evalResult'),
    cell: (row) => (
      <StatusBadge tone={row.passed ? 'success' : 'danger'}>
        {row.passed ? t('aiInsights.evalPassed') : t('aiInsights.evalFailed')}
      </StatusBadge>
    ),
  },
  {
    key: 'held',
    header: t('aiInsights.evalHeld'),
    cell: (row) =>
      t('aiInsights.ofCases', {
        count: format.number(row.held),
        cases: format.number(row.cases),
      }),
  },
  {
    key: 'figures',
    header: t('aiInsights.evalFigures'),
    cell: (row) => (
      <ul className="flex flex-col gap-1">
        {Object.entries(row.figures).map(([name, value]) => (
          <li key={name}>
            {label('aiInsights.evalFigureNames', name)}: {format.number(value)}
          </li>
        ))}
      </ul>
    ),
  },
  {
    key: 'failed',
    header: t('aiInsights.evalFailedCases'),
    cell: (row) =>
      row.failed.length > 0 ? (
        <code className="break-all">{row.failed.join(', ')}</code>
      ) : (
        t('aiInsights.evalNone')
      ),
  },
  {
    key: 'commit',
    header: t('aiInsights.evalCommit'),
    cell: (row) => (row.commit ? <code>{row.commit.slice(0, 7)}</code> : t('aiInsights.evalNone')),
  },
  { key: 'ranAt', header: t('aiInsights.evalRanAt'), cell: (row) => format.dateTime(row.ranAt) },
];

/** The eval runs staff recorded (ADR-106): the latest of each suite, then the history. */
function EvalsSection({ evals, manage }: { evals: Evals; manage: boolean }) {
  return (
    <Section
      title={t('aiInsights.evals')}
      intro={t('aiInsights.evalsIntro')}
      actions={manage ? <RecordEvalDialog /> : undefined}
    >
      <div data-testid="quality-evals" className="flex flex-col gap-3">
        <DataTable
          caption={t('aiInsights.evalsLatest')}
          rows={evals.latest}
          rowKey={(row) => row.id}
          empty={t('aiInsights.evalsEmpty')}
          columns={evalColumns}
        />
        {evals.recent.length > evals.latest.length ? (
          <>
            <h3 className="font-heading text-h5 font-bold text-heading">
              {t('aiInsights.evalsHistory')}
            </h3>
            <DataTable
              caption={t('aiInsights.evalsHistory')}
              rows={evals.recent}
              rowKey={(row) => row.id}
              columns={evalColumns}
            />
          </>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * What the assistant cost and how well it answered (ADR-106): estimated spend by agent, model,
 * channel, day and account with a forecast for the month, the quality of its answers by prompt
 * version, the eval runs staff recorded, and the limits in force. Every cost is an estimate
 * from token counts at configured prices, and the page says so. Reading needs `ai:read`; the
 * one thing that changes anything, recording an eval run, needs `ai:manage`.
 */
export function AiInsightsPage() {
  const { can } = useStaffSession();
  const [days, setDays] = useState<Period>(30);
  const query = { params: { query: { days } } };
  const cost = $api.useQuery('get', '/v1/admin/ai/cost', query);
  const quality = $api.useQuery('get', '/v1/admin/ai/quality', query);
  const evals = $api.useQuery('get', EVALS, {});
  const limits = $api.useQuery('get', '/v1/admin/ai/limits', {});
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader title={t('aiInsights.title')} intro={t('aiInsights.intro')} />
        <SelectField
          className="max-w-popover"
          label={t('aiInsights.period')}
          name="days"
          value={String(days)}
          options={PERIODS.map((value) => ({
            value: String(value),
            label: label('aiInsights.periods', `d${String(value)}`),
          }))}
          onChange={(event) => setDays(Number(event.target.value) as Period)}
        />
        <QueryState query={cost}>{(data) => <CostSection cost={data} />}</QueryState>
        <QueryState query={quality}>{(data) => <QualitySection quality={data} />}</QueryState>
        <QueryState query={evals}>
          {(data) => <EvalsSection evals={data} manage={can('ai:manage')} />}
        </QueryState>
        <QueryState query={limits}>{(data) => <LimitsSection limits={data} />}</QueryState>
      </div>
    </RequirePermission>
  );
}
