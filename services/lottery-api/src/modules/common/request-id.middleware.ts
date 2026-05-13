import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export class RequestIdMiddleware {
  use(req: FastifyRequest["raw"], res: FastifyReply["raw"], next: () => void): void {
    const requestId = req.headers["x-request-id"]?.toString() || randomUUID();
    req.headers["x-request-id"] = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  }
}
