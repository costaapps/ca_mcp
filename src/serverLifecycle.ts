export type ShutdownSignal = 'SIGINT' | 'SIGTERM';

export interface ShutdownSignalSource {
  once(signal: ShutdownSignal, listener: () => void): unknown;
}

export interface ShutdownHttpServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections(): void;
}

export interface ShutdownRuntime {
  beginDrain(): void;
  close(timeoutMs?: number): Promise<void>;
}

export interface ShutdownLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface ShutdownHandlerOptions {
  readonly server: ShutdownHttpServer;
  readonly runtime: ShutdownRuntime;
  readonly timeoutMs: number;
  readonly processLike?: ShutdownSignalSource;
  readonly exit?: (code: number) => void;
  readonly logger?: ShutdownLogger;
  readonly now?: () => number;
}

async function closeHttpServer(server: ShutdownHttpServer, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    let completed = false;
    const finish = (): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      server.closeAllConnections();
      finish();
    }, timeoutMs);
    timeout.unref();

    server.close(() => finish());
  });
}

/** Register bounded SIGINT/SIGTERM handling for the HTTP and tenant runtimes. */
export function installShutdownHandlers(options: ShutdownHandlerOptions): void {
  const processLike = options.processLike ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  let shuttingDown = false;

  async function shutdown(signal: ShutdownSignal): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = now() + options.timeoutMs;
    options.runtime.beginDrain();
    logger.info(JSON.stringify({ type: 'server_shutdown', signal }));

    await Promise.all([
      closeHttpServer(options.server, Math.max(0, deadline - now())),
      options.runtime.close(Math.max(0, deadline - now()))
    ]);
  }

  function handleSignal(signal: ShutdownSignal): void {
    if (shuttingDown) return;
    void shutdown(signal).then(
      () => exit(0),
      () => {
        logger.error(JSON.stringify({ type: 'server_shutdown_failed', signal }));
        exit(1);
      }
    );
  }

  processLike.once('SIGINT', () => handleSignal('SIGINT'));
  processLike.once('SIGTERM', () => handleSignal('SIGTERM'));
}
