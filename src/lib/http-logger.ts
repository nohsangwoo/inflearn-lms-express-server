import pinoHttpModule from "pino-http";
import type { Options as PinoHttpOptions } from "pino-http";
import type { RequestHandler } from "express";

// pino-http의 실제 export가 함수임을 한 번만 알려줌
const _factory = pinoHttpModule as unknown as ( opts?: PinoHttpOptions ) => RequestHandler;

export function httpLogger( opts?: PinoHttpOptions ): RequestHandler {
    return _factory(opts);
}