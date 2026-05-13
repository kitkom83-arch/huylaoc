import { Injectable } from "@nestjs/common";
import { PrismaRepository } from "../store/prisma.repository.js";

@Injectable()
export class CatalogService {
  constructor(private readonly repo: PrismaRepository) {}

  listBetTypes() {
    return this.repo.listEnabledBetTypes();
  }
}
