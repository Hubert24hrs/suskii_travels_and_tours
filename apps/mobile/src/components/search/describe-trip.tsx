import { color } from '@suskii/design-tokens';
import { useFormatters } from '@suskii/i18n/react';
import { NATURAL_SEARCH_MIN_LENGTH } from '@suskii/shared';
import { Button, Input, iconSize } from '@suskii/ui-native';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import {
  describeTrip,
  type DescribeOutcome,
  type NaturalSearchResult,
} from '../../lib/natural-search';
import { useApp, useT } from '../../providers/app-provider';

type Notice = { tone: 'status' | 'alert'; text: string } | null;

/**
 * AI trip search (ADR-061): the traveller describes a trip and the flight form below is filled
 * from it. It never searches by itself, and every failure keeps the text and points to the form.
 */
export function DescribeTrip({
  maxLength,
  onFill,
}: {
  maxLength: number;
  onFill: (result: NaturalSearchResult) => void;
}) {
  const { t } = useT();
  const { api } = useApp();
  const format = useFormatters();
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const filledNotice = (result: NaturalSearchResult): string => {
    const parts = [t('search.describe.filled')];
    if (result.missing.length > 0) {
      const fields = result.missing.map((field) => t(`search.describe.fields.${field}`));
      parts.push(t('search.describe.missing', { fields: format.list(fields) }));
    }
    if (result.departureMonth && !result.draft.departureDate && !result.draft.legs.length) {
      parts.push(
        t('search.describe.month', {
          month: format.date(`${result.departureMonth}-01`, 'month'),
        }),
      );
    }
    return parts.join(' ');
  };

  const show = (outcome: DescribeOutcome): void => {
    if (outcome.kind === 'filled') {
      onFill(outcome.result);
      setNotice({ tone: 'status', text: filledNotice(outcome.result) });
      return;
    }
    setNotice({ tone: 'alert', text: t(`search.describe.${outcome.kind}`) });
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length < NATURAL_SEARCH_MIN_LENGTH) {
      setNotice({ tone: 'alert', text: t('search.describe.tooShort') });
      return;
    }
    setWorking(true);
    setNotice(null);
    try {
      show(await describeTrip(api, trimmed));
    } finally {
      setWorking(false);
    }
  };

  return (
    <View
      testID="describe-trip"
      className="gap-2 rounded-md border border-border bg-background p-3"
    >
      <Input
        testID="describe-trip-text"
        label={t('search.describe.label')}
        placeholder={t('search.describe.placeholder')}
        value={text}
        onChangeText={setText}
        maxLength={maxLength}
        autoCorrect={false}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        hint={t('search.describe.privacy')}
        icon={<Sparkles color={color.muted} size={iconSize.md} />}
      />
      <Button
        testID="describe-trip-submit"
        variant="ghost"
        fullWidth
        loading={working}
        onPress={() => void submit()}
      >
        {working ? t('search.describe.working') : t('search.describe.submit')}
      </Button>
      {notice ? (
        <Text
          testID="describe-trip-notice"
          accessibilityRole={notice.tone === 'alert' ? 'alert' : 'text'}
          accessibilityLiveRegion="polite"
          className={
            notice.tone === 'alert'
              ? 'font-body text-body-sm text-danger'
              : 'font-body text-body-sm text-foreground'
          }
        >
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}
