type V3 = { x: number; y: number; z: number };
export type FlyCamera = {
  update(dt: number): void;
  setView(position: V3, target: V3, snap?: boolean): void;
  frame(point: V3, radius?: number): void;
  reset(): void;
  dispose(): void;
};
export function createFlyCamera(
  camera: unknown,
  dom: HTMLElement,
  options: { position: V3; target: V3; getFocus?: (index: number) => { point: V3; radius: number } | undefined },
): FlyCamera;
