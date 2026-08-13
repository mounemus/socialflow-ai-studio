/**
 * Incrustation du logo de marque sur un visuel — géométrie pure, testable.
 * La composition d'image elle-même (sharp) vit dans la route API.
 */

export type LogoPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

export interface LogoOverlayParams {
  position: LogoPosition;
  /** Largeur du logo en % de la largeur du visuel (5-40). */
  sizePct: number;
  /** Opacité du logo en % (10-100). */
  opacity: number;
  /** Marge depuis les bords en % de la largeur du visuel (0-10). */
  marginPct: number;
}

export const DEFAULT_LOGO_PARAMS: LogoOverlayParams = {
  position: 'bottom-right',
  sizePct: 14,
  opacity: 90,
  marginPct: 3,
};

const clamp = (v: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : NaN;

/** Normalise des paramètres utilisateur — valeurs hors bornes ramenées aux défauts. */
export function normalizeLogoParams(input: Partial<LogoOverlayParams> | undefined): LogoOverlayParams {
  const d = DEFAULT_LOGO_PARAMS;
  const positions: LogoPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
  const sizePct = clamp(Number(input?.sizePct), 5, 40);
  const opacity = clamp(Number(input?.opacity), 10, 100);
  const marginPct = clamp(Number(input?.marginPct), 0, 10);
  return {
    position: positions.includes(input?.position as LogoPosition) ? (input!.position as LogoPosition) : d.position,
    sizePct: Number.isNaN(sizePct) ? d.sizePct : sizePct,
    opacity: Number.isNaN(opacity) ? d.opacity : opacity,
    marginPct: Number.isNaN(marginPct) ? d.marginPct : marginPct,
  };
}

/**
 * Position (left/top) du logo dans le visuel. Le logo est déjà redimensionné
 * (logoW × logoH). Toujours entièrement DANS l'image, même marge 0.
 */
export function logoPlacement(
  baseW: number,
  baseH: number,
  logoW: number,
  logoH: number,
  params: Pick<LogoOverlayParams, 'position' | 'marginPct'>,
): { left: number; top: number } {
  const margin = Math.round((baseW * params.marginPct) / 100);
  const maxLeft = Math.max(0, baseW - logoW);
  const maxTop = Math.max(0, baseH - logoH);
  const c = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  switch (params.position) {
    case 'top-left':
      return { left: c(margin, maxLeft), top: c(margin, maxTop) };
    case 'top-right':
      return { left: c(baseW - logoW - margin, maxLeft), top: c(margin, maxTop) };
    case 'bottom-left':
      return { left: c(margin, maxLeft), top: c(baseH - logoH - margin, maxTop) };
    case 'center':
      return { left: c((baseW - logoW) / 2, maxLeft), top: c((baseH - logoH) / 2, maxTop) };
    case 'bottom-right':
    default:
      return { left: c(baseW - logoW - margin, maxLeft), top: c(baseH - logoH - margin, maxTop) };
  }
}
