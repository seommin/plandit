import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { z } from "zod";

import { InternalApiGuard } from "../internal-api.guard";
import { ApiError, ErrorCode } from "./api-error";
import { toErrorBody } from "./api-exception.filter";
import { ZodPipe } from "./zod";
import { monthIn, toLocalIso } from "./zoned-time";

describe("toErrorBody", () => {
  it("keeps ApiError code, status and details", () => {
    const result = toErrorBody(new ApiError(ErrorCode.CONFLICT, "dup", { id: 1 }));
    expect(result).toEqual({ status: 409, body: { code: "CONFLICT", message: "dup", details: { id: 1 } } });
  });

  it("maps Nest HttpExceptions by status", () => {
    expect(toErrorBody(new UnauthorizedException("nope")).body.code).toBe("UNAUTHORIZED");
    expect(toErrorBody(new NotFoundException("gone")).body).toEqual({ code: "NOT_FOUND", message: "gone" });
  });

  it("hides unknown errors behind a generic 500", () => {
    expect(toErrorBody(new Error("db password is hunter2"))).toEqual({
      status: 500,
      body: { code: "INTERNAL_ERROR", message: "Internal server error." },
    });
  });
});

describe("ZodPipe", () => {
  const pipe = new ZodPipe(z.object({ email: z.string().email(), age: z.number() }));

  it("returns parsed data", () => {
    expect(pipe.transform({ email: "a@b.co", age: 1 })).toEqual({ email: "a@b.co", age: 1 });
  });

  it("throws VALIDATION_FAILED with per-field details", () => {
    try {
      pipe.transform({ email: "x" });
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe(ErrorCode.VALIDATION_FAILED);
      expect((error as ApiError).details).toEqual([
        { path: "email", message: expect.any(String) },
        { path: "age", message: expect.any(String) },
      ]);
    }
  });
});

describe("InternalApiGuard", () => {
  const context = (headers: Record<string, string>, isPublic = false) => {
    const handler = () => undefined;
    if (isPublic) Reflect.defineMetadata("isPublic", true, handler);
    return {
      getHandler: () => handler,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as never;
  };
  const guard = new InternalApiGuard(new Reflector());

  beforeAll(() => {
    process.env.API_INTERNAL_SECRET = "secret";
  });

  it("accepts the correct secret", () => {
    expect(guard.canActivate(context({ "x-api-secret": "secret" }))).toBe(true);
  });

  it("rejects a wrong or missing secret", () => {
    expect(() => guard.canActivate(context({ "x-api-secret": "secreT" }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(context({}))).toThrow(UnauthorizedException);
  });

  it("lets @Public() handlers through without a secret", () => {
    expect(guard.canActivate(context({}, true))).toBe(true);
  });
});

describe("monthIn", () => {
  const kst = (instant: Date) => toLocalIso(instant, "Asia/Seoul");

  it("starts the month at local midnight on the 1st, not UTC", () => {
    // 2026-09-30 20:00 UTC is already 1 October 05:00 in Seoul
    const month = monthIn(new Date("2026-09-30T20:00:00Z"), "Asia/Seoul");
    expect([kst(month.start), kst(month.end)]).toEqual(["2026-10-01T00:00:00+09:00", "2026-11-01T00:00:00+09:00"]);
    expect(month.start.toISOString()).toBe("2026-09-30T15:00:00.000Z");
  });

  it("rolls December into the next year and follows DST elsewhere", () => {
    const december = monthIn(new Date("2026-12-15T00:00:00Z"), "Asia/Seoul");
    expect(kst(december.end)).toBe("2027-01-01T00:00:00+09:00");
    const october = monthIn(new Date("2026-10-15T12:00:00Z"), "Europe/Paris"); // DST ends 25 Oct
    expect([toLocalIso(october.start, "Europe/Paris"), toLocalIso(october.end, "Europe/Paris")]).toEqual(["2026-10-01T00:00:00+02:00", "2026-11-01T00:00:00+01:00"]);
  });
});
