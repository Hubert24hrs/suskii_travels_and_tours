import { HOTEL_ART, hotelArtSvg, type HotelScene } from '../../../../lib/art';
import { notFound, svgResponse } from '../../../../lib/art-response';

/** GET /art/hotels/h3k9-room.svg: a sample picture of a demo hotel (ADR-096). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const { name } = await params;
  const match = HOTEL_ART.exec(name.replace(/\.svg$/, ''));
  if (!match?.[1] || !match[2]) return notFound();
  return svgResponse(hotelArtSvg(match[1], match[2] as HotelScene));
}
