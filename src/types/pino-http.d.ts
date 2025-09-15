// pino-http가 req/res에 주입하는 log를 타입으로 알려주기
import type { Logger } from "pino";


//  (http/1.1)
declare module "http" {
    interface IncomingMessage {
        log: Logger;
    }
    interface ServerResponse {
        log: Logger;
    }
}


//  (HTTP/2)
declare module "http2" {
    interface Http2ServerRequest {
        log: Logger;
    }
    interface Http2ServerResponse {
        log: Logger;
    }
}


//  (express의 request에 직접 보강해도 OK)
declare module "express-serve-static-core" {
    interface Request {
        log: Logger;
    }
    interface Response {
        log: Logger;
    }
}
