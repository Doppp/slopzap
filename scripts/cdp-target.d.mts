export interface TargetEvent {
  sessionId: string;
  message: string;
}
export interface TargetTransport {
  send(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  on(event: string, listener: (event: TargetEvent) => void): unknown;
  off(event: string, listener: (event: TargetEvent) => void): unknown;
}
export function targetSession(
  browser: TargetTransport,
  targetId: string,
  deadlineMs?: number,
): {
  connect(): Promise<void>;
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};
export function keyEvents(
  key: string,
  code: string,
  windowsVirtualKeyCode: number,
): Record<string, unknown>[];
