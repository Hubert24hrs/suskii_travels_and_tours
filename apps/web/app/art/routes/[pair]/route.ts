import { IATA_PAIR, routeArtSvg } from '../../../../lib/art';
import { notFound, svgResponse } from '../../../../lib/art-response';

/** GET /art/routes/LOS-LHR.svg: the deal card illustration for a route. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pair: string }> },
): Promise<Response> {
  const { pair } = await params;
  const match = IATA_PAIR.exec(pair.replace(/\.svg$/, ''));
  if (!match?.[1] || !match[2]) return notFound();
  return svgResponse(routeArtSvg(match[1], match[2]));
}
