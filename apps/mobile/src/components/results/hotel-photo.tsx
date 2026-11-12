import type { Schemas } from '@suskii/api-client';
import { useMemo } from 'react';
import { Image, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SvgUri } from 'react-native-svg';

import { appConfig } from '../../config';
import { useT } from '../../providers/app-provider';

type Photo = Schemas['HotelPhoto'];

/** The demo supplier's drawn pictures on the website: `/art/hotels/{seed}-{scene}.svg`. */
const OWN_ART =
  /^https?:\/\/[^/]+(\/art\/hotels\/[a-z0-9]{1,32}-(?:exterior|room|pool|dining)\.svg)$/;
const HTTPS = /^https:\/\/[^\s/]+\/\S*$/;

/**
 * What the app may load for a photo (ADR-096): our own drawings from the website the app talks
 * to, whatever host the API named, and a supplier's photograph over https. Anything else is
 * left out.
 */
export function photoSource(url: string): { kind: 'drawn' | 'photo'; uri: string } | null {
  const own = OWN_ART.exec(url);
  if (own?.[1]) return { kind: 'drawn', uri: `${appConfig.webBaseUrl}${own[1]}` };
  return HTTPS.test(url) ? { kind: 'photo', uri: url } : null;
}

/** One picture, filling the box its parent gives it. `label` names it for screen readers. */
export function HotelPhoto({
  photo,
  label,
  testID,
}: {
  photo: Photo;
  /** Empty for a decorative picture beside the hotel's name. */
  label: string;
  testID?: string;
}) {
  const source = photoSource(photo.url);
  if (!source) return null;
  return (
    <View
      testID={testID}
      accessible={label !== ''}
      accessibilityRole={label === '' ? undefined : 'image'}
      accessibilityLabel={label === '' ? undefined : label}
      className="aspect-video w-full overflow-hidden rounded-lg bg-skeleton"
    >
      {source.kind === 'drawn' ? (
        <SvgUri uri={source.uri} width="100%" height="100%" />
      ) : (
        <Image source={{ uri: source.uri }} resizeMode="cover" className="size-full" />
      )}
    </View>
  );
}

/** A hotel's photos side by side, swiped sideways; each is named "photo 2 of 4". */
export function PhotoGallery({
  hotel,
  photos,
  sample,
}: {
  hotel: string;
  photos: readonly Photo[];
  /** Demo data: the pictures are drawings, and the screen says so. */
  sample: boolean;
}) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  // Most of the screen, so the next photo peeks in and shows there is more.
  const page = useMemo(() => ({ width: Math.round(width * 0.8) }), [width]);
  const shown = photos.filter((photo) => photoSource(photo.url) !== null);
  if (shown.length === 0) return null;
  return (
    <View className="gap-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        testID="hotel-gallery"
        contentContainerClassName="gap-2"
      >
        {shown.map((photo, index) => {
          const name = t('results.stayContent.photoAlt', {
            hotel,
            number: index + 1,
            total: shown.length,
          });
          return (
            <View key={photo.url} style={page}>
              <HotelPhoto
                photo={photo}
                label={photo.caption ? `${name}. ${photo.caption}` : name}
                testID={`hotel-photo-${index}`}
              />
            </View>
          );
        })}
      </ScrollView>
      {sample ? (
        <Text className="font-body text-caption text-muted">
          {t('results.stayContent.samplePhotos')}
        </Text>
      ) : null}
    </View>
  );
}
