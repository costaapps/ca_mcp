import type { Request, Response } from 'express';

export interface ReadinessState {
  isReady(): Promise<boolean>;
}

export function healthHandler(_request: Request, response: Response): void {
  response.status(200).json({ status: 'ok' });
}

export const liveHealthHandler = healthHandler;

export function readinessHandler(state: ReadinessState) {
  return async (_request: Request, response: Response): Promise<void> => {
    let ready = false;
    try {
      ready = await state.isReady();
    } catch {
      ready = false;
    }
    response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
  };
}
