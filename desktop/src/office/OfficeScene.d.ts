/** Contract every office scene implements (3D office, studio, pixel hall). */
export type OfficeScene = {
  setBoss(name: string, role?: string): void;
  setAgents(list: { name: string; role?: string }[]): void;
  visit(from: string, to: string, text: string): void;
  setWorking(name: string, on: boolean): void;
  destroy(): void;
};
export type SceneOptions = { driven?: boolean; background?: number };
export function createOfficeScene(container: HTMLElement, options?: SceneOptions): OfficeScene;
