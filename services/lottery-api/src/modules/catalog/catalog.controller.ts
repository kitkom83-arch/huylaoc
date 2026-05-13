import { Controller, Get } from "@nestjs/common";
import { CatalogService } from "./catalog.service.js";

@Controller("/v1/catalog")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("/bet-types")
  async betTypes() {
    return { bet_types: await this.catalog.listBetTypes() };
  }
}
