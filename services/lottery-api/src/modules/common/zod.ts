import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

type ParseableSchema = z.ZodType<unknown, z.ZodTypeDef, unknown>;

export function parseBody<TSchema extends ParseableSchema>(schema: TSchema, body: unknown): z.output<TSchema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join("; "));
  }
  return parsed.data;
}
