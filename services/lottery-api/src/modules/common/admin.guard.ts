import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!req.routeOptions?.url?.startsWith("/v1/admin")) {
      return true;
    }
    if (req.headers["x-admin-role"] !== "admin" || !req.headers["x-admin-id"]) {
      throw new ForbiddenException("admin role required");
    }
    return true;
  }
}
