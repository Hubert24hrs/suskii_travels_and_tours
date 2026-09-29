import { CITY_NAME, cityArtSvg } from '../../../../lib/art';
import { notFound, svgResponse } from '../../../../lib/art-response';

/** GET /art/cities/Cape%20Town.svg: the destination card illustration for a city. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ city: string }> },
): Promise<Response> {
  const { city } = await params;
  let name: string;
  try {
    name = decodeURIComponent(city).replace(/\.svg$/, '');
  } catch {
    return notFound();
  }
  if (!CITY_NAME.test(name)) return notFound();
  return svgResponse(cityArtSvg(name));
}
