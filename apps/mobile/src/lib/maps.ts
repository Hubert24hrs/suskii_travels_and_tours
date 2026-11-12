import { Linking, Platform } from 'react-native';

/** The maps app's address for a place: `geo:` on Android, Apple Maps on iPhone. */
export function mapsUrl(latitude: number, longitude: number, label: string): string {
  const name = encodeURIComponent(label.slice(0, 80));
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?ll=${latitude},${longitude}&q=${name}`
    : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${name})`;
}

/**
 * Opens a place in the phone's maps app (ADR-097): streets and directions live there. Falls
 * back to OpenStreetMap in the browser when no maps app answers.
 */
export async function openMaps(latitude: number, longitude: number, label: string): Promise<void> {
  try {
    await Linking.openURL(mapsUrl(latitude, longitude, label));
  } catch {
    await Linking.openURL(
      `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`,
    ).catch(() => undefined);
  }
}
