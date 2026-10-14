import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface CoreFakeRequest {
  method: string;
  path: string;
  body: unknown;
}

export interface CoreFakeResponse {
  status?: number;
  body: unknown;
}

export interface CoreHttpFake {
  baseUrl: string;
  requests: CoreFakeRequest[];
  close(): Promise<void>;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function writeJson(response: ServerResponse, result: CoreFakeResponse): void {
  response.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(result.body));
}

/** Starts an in-process HTTP endpoint suitable for Core client integration tests. */
export async function startCoreHttpFake(
  handler: (request: CoreFakeRequest) => CoreFakeResponse | Promise<CoreFakeResponse>,
  options: { listenHost?: string } = {}
): Promise<CoreHttpFake> {
  const requests: CoreFakeRequest[] = [];
  const server: Server = createServer((incoming, response) => {
    void readJson(incoming).then(async (body) => {
      const request: CoreFakeRequest = {
        method: incoming.method ?? 'GET',
        path: incoming.url ?? '/',
        body
      };
      requests.push(request);
      writeJson(response, await handler(request));
    }).catch(() => {
      if (response.headersSent) return;
      writeJson(response, { status: 400, body: { Success: false, Data: null } });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, options.listenHost ?? '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Não foi possível obter a porta do Core HTTP fake.');
  }

  return {
    // Keep the local target stable even when the listener binds all interfaces.
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}
