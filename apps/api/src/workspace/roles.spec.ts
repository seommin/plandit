import { roleCovers } from "@plandit/shared/workspaces";

describe("roleCovers", () => {
  it.each([
    ["OWNER", "OWNER", true],
    ["OWNER", "ADMIN", true],
    ["OWNER", "MEMBER", true],
    ["ADMIN", "OWNER", false],
    ["ADMIN", "ADMIN", true],
    ["ADMIN", "MEMBER", true],
    ["MEMBER", "OWNER", false],
    ["MEMBER", "ADMIN", false],
    ["MEMBER", "MEMBER", true],
  ] as const)("%s covers %s → %s", (actor, required, expected) => {
    expect(roleCovers(actor, required)).toBe(expected);
  });
});
