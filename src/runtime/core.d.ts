export const W: number;
export const H: number;
export const BUTTONS: string[];
export function makeTextRenderer(getCtx: () => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null): {
  text(str: string, x: number, y: number, opts?: { color?: string; scale?: number; align?: 'left' | 'center' | 'right'; shadow?: string | null }): void;
  textWidth(str: string, scale?: number): number;
};
export function createApi(opts: any): any;
export function createInputTracker(): any;
export function createCart(mod: any, apiOpts: any): any;
