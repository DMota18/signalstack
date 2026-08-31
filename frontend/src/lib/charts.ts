import * as LightweightCharts from 'lightweight-charts';

/**
 * The chart library, bundled at build time.
 *
 * Previously each chart component injected a <script> from unpkg at
 * runtime — an unpinned, SRI-less dependency on a third-party CDN that
 * broke offline use. The promise form is kept so existing call sites
 * that gate on "library loaded" keep working unchanged.
 */
export function loadLightweightCharts(): Promise<typeof LightweightCharts> {
  return Promise.resolve(LightweightCharts);
}

export { LightweightCharts };
