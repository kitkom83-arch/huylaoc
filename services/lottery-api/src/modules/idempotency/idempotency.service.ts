import { ConflictException, Injectable, BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaRepository, type DbClient } from "../store/prisma.repository.js";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly repo: PrismaRepository) {}

  async run<T>(input: {
    scope: string;
    actorRef: string;
    key: string | undefined;
    body: unknown;
    successStatus?: number;
    storedResponse?: (response: T) => unknown;
    replayResponse?: (storedResponse: unknown, tx: Prisma.TransactionClient) => Promise<T> | T;
    handler: (tx: Prisma.TransactionClient) => Promise<T> | T;
  }): Promise<T> {
    if (!input.key) {
      throw new BadRequestException("Idempotency-Key header is required");
    }
    const key = input.key;
    const requestHash = sha256(stableStringify(input.body));
    return this.repo.client().$transaction(async (tx) => {
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO idempotency_keys (scope, actor_ref, idempotency_key, request_hash)
        VALUES (${input.scope}, ${input.actorRef}, ${key}, ${requestHash})
        ON CONFLICT (scope, actor_ref, idempotency_key) DO NOTHING
        RETURNING id
      `;
      if (inserted.length === 0) {
        return this.readExisting<T>(
          {
            scope: input.scope,
            actorRef: input.actorRef,
            key,
            requestHash
          },
          tx,
          input.replayResponse
        );
      }

      const responseBody = await input.handler(tx);
      await tx.idempotencyKey.update({
        where: {
          scope_actor_ref_idempotency_key: {
            scope: input.scope,
            actor_ref: input.actorRef,
            idempotency_key: key
          }
        },
        data: {
          response_body: (input.storedResponse ? input.storedResponse(responseBody) : responseBody) as Prisma.InputJsonValue,
          response_status: input.successStatus ?? 200
        }
      });
      return responseBody;
    });
  }

  private async readExisting<T>(
    input: { scope: string; actorRef: string; key: string; requestHash: string },
    db: DbClient,
    replayResponse?: (storedResponse: unknown, tx: Prisma.TransactionClient) => Promise<T> | T
  ): Promise<T> {
    const rows = await db.$queryRaw<
      Array<{ request_hash: string; response_body: Prisma.JsonValue | null }>
    >`SELECT request_hash, response_body FROM idempotency_keys WHERE scope = ${input.scope} AND actor_ref = ${input.actorRef} AND idempotency_key = ${input.key} FOR UPDATE`;
    const existing = rows[0];
    if (!existing) {
      throw new ConflictException("Idempotency-Key is currently being processed");
    }
    if (existing.request_hash !== input.requestHash) {
      throw new ConflictException("Idempotency-Key was already used with a different body");
    }
    if (existing.response_body === null) {
      throw new ConflictException("Idempotency-Key is currently being processed");
    }
    if (replayResponse) {
      return replayResponse(existing.response_body, db as Prisma.TransactionClient);
    }
    return existing.response_body as T;
  }
}
