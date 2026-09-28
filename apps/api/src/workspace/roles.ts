import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { prisma, type WorkspaceMember } from "@plandit/database/prisma";
import { roleCovers, type WorkspaceRoleName } from "@plandit/shared/workspaces";

import { ApiError, ErrorCode } from "../common/api-error";
import { getUserId, type RequestWithUser } from "../request-user";

const ROLE_KEY = "workspaceRole";

/** Requires membership of `:workspaceId` with at least `role`. Non-members get 404, weaker roles 403. */
export const Roles = (role: WorkspaceRoleName) => SetMetadata(ROLE_KEY, role);

type RequestWithMember = RequestWithUser & {
  params: Record<string, string | undefined>;
  workspaceMember?: WorkspaceMember;
};

/** The caller's membership, loaded by RolesGuard. Only valid on @Roles() handlers. */
export const CurrentMember = createParamDecorator(
  (_: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<RequestWithMember>().workspaceMember as WorkspaceMember,
);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<WorkspaceRoleName | undefined>(ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<RequestWithMember>();
    const userId = getUserId(request);
    const workspaceId = request.params.workspaceId;
    const member = workspaceId
      ? await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } })
      : null;

    if (!member) throw new ApiError(ErrorCode.NOT_FOUND, "Workspace not found.");
    if (!roleCovers(member.role, required)) {
      throw new ApiError(ErrorCode.FORBIDDEN, `Requires ${required} role or higher.`);
    }

    request.workspaceMember = member;
    return true;
  }
}
