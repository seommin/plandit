import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";

/** Skips the internal-secret check. Only for endpoints that authenticate another way (e.g. webhook signatures). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
