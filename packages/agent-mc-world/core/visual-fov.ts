/** Perspective field of view in vertical degrees, matching the renderer camera. */
export const DEFAULT_VISUAL_FOV = 120;

export function visualFovError(mode: unknown, fov: unknown): string | undefined {
  if (fov === undefined) return undefined;
  if (mode !== undefined && mode !== 'first' && mode !== 'third')
    return 'fov 仅支持 first/third；俯视图用 width 调整范围';
  if (typeof fov !== 'number' || !Number.isFinite(fov) || fov < 30 || fov > 140)
    return 'fov 必须为 30–140 度的有限数值';
  return undefined;
}

export function visualFov(mode: string, fov?: number): number | undefined {
  const error = visualFovError(mode, fov);
  if (error) throw new RangeError(error);
  return mode === 'first' || mode === 'third' ? fov ?? DEFAULT_VISUAL_FOV : undefined;
}
