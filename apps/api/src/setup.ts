import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";

import { traceMiddleware } from "./common/request-context";
import { finishDocument, TAGS } from "./common/swagger";
import { httpMetricsMiddleware } from "./metrics/http-metrics.middleware";

/** Shared by main.ts and e2e tests so both run the exact same app wiring. */
export function configureApp(app: INestApplication) {
  app.use(traceMiddleware);
  app.use(httpMetricsMiddleware);
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.enableCors({
    credentials: true,
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
  });

  const builder = new DocumentBuilder()
    .setTitle("Plandit API")
    .setDescription(
      [
        "팀 캘린더 + 리마인더 발송 + 크레딧 과금 API.",
        "",
        "- **인증**: 대부분의 경로는 web 서버만 부른다(`x-api-secret` + `x-user-id`). 외부에서 직접 들어오는 경로는 웹훅(서명)과 공개 API `/v1`(API 키) 두 가지뿐이다.",
        "- **오류**: 모든 오류는 같은 모양 `{ code, message, details?, traceId }`(아래 ApiError). `traceId`는 응답 헤더 `x-trace-id`와 같다.",
        "- **목록**: `?limit=&cursor=` 커서 페이지네이션, 응답은 `{ items, nextCursor }`.",
      ].join("\n"),
    )
    .setVersion("0.1.0")
    .addApiKey({ type: "apiKey", in: "header", name: "x-api-secret" }, "internal-secret")
    .addApiKey({ type: "apiKey", in: "header", name: "x-user-id" }, "user-id")
    .addBearerAuth({ type: "http", scheme: "bearer", description: "pk_… API key (public /v1 API)" }, "api-key")
    .addSecurityRequirements("internal-secret")
    .addSecurityRequirements("user-id");
  for (const [name, description] of TAGS) builder.addTag(name, description);
  const config = builder.build();
  SwaggerModule.setup("docs", app, () => finishDocument(SwaggerModule.createDocument(app, config)));

  return app;
}
