import { BadRequestException, Controller, Delete, Get, Param, Post, Req, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { ErrorCode } from "../common/api-error";
import { ApiErrors } from "../common/swagger";
import { getUserId, type RequestWithUser } from "../request-user";
import { DOCUMENT_MAX_BYTES, type UploadedFile as File } from "./document-text";
import { MemoryService } from "./memory.service";

const DOCUMENT_EXAMPLE = {
  id: "cmuq2doc0001qwyj8f1k2abcd",
  eventId: "cmum9ih8o0005qwyjimytsk02",
  filename: "A사 미팅 회의록.pdf",
  mimeType: "application/pdf",
  sizeBytes: 48213,
  charCount: 3120,
  status: "PROCESSING",
  chunkCount: 5,
  uploadedBy: { id: "cmum8us8f0000ekyjnxhqh0h4", name: "김데모" },
  createdAt: "2026-10-08T02:00:00.000Z",
  readyAt: null,
};

/** Browsers send multipart filenames as UTF-8, which multer reads as latin1: undo that when it round-trips cleanly. */
function utf8Name(name: string) {
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes(String.fromCharCode(0xfffd)) ? name : decoded; // U+FFFD: it was not UTF-8 after all
}

@ApiTags("회의록")
@ApiErrors(ErrorCode.NOT_FOUND)
@Controller("events/:eventId/documents")
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Post()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } }))
  @ApiOperation({
    summary: "회의록 첨부 (일정을 수정할 수 있는 사람)",
    description:
      "PDF·TXT·MD 한 개(최대 5MB, 글자 20만 자). 글자를 바로 뽑아 조각(약 800자)으로 나눠 저장하고 원본 파일은 보관하지 않는다. 조각의 임베딩은 워커가 만들고 끝나면 READY(검색됨). 글자가 없는 파일(스캔한 PDF)·깨진 파일·다른 형식은 400 `DOCUMENT_UNREADABLE`이고 아무것도 저장하지 않는다. 그 일정을 볼 수 있는 사람만 검색할 수 있다.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  @ApiCreatedResponse({ example: DOCUMENT_EXAMPLE })
  @ApiErrors(ErrorCode.FORBIDDEN, ErrorCode.DOCUMENT_UNREADABLE, ErrorCode.BAD_REQUEST)
  upload(@Req() request: RequestWithUser, @Param("eventId") eventId: string, @UploadedFile() file: File | undefined) {
    if (!file) throw new BadRequestException("Attach one file as `file`.");
    return this.memory.upload(getUserId(request), eventId, { ...file, originalname: utf8Name(file.originalname) });
  }

  @Get()
  @ApiOperation({ summary: "일정의 회의록 목록", description: "그 일정을 볼 수 있는 사람(일정 목록과 같은 공개 범위). 최신순. 상태 PROCESSING(임베딩 중) → READY." })
  @ApiOkResponse({ example: { items: [{ ...DOCUMENT_EXAMPLE, status: "READY", readyAt: "2026-10-08T02:00:04.000Z" }] } })
  list(@Req() request: RequestWithUser, @Param("eventId") eventId: string) {
    return this.memory.list(getUserId(request), eventId);
  }

  @Delete(":documentId")
  @ApiOperation({ summary: "회의록 삭제 (일정을 수정할 수 있는 사람)", description: "조각과 임베딩도 함께 지워져 더는 검색되지 않는다." })
  @ApiOkResponse({ example: { ok: true } })
  @ApiErrors(ErrorCode.FORBIDDEN)
  remove(@Req() request: RequestWithUser, @Param("eventId") eventId: string, @Param("documentId") documentId: string) {
    return this.memory.remove(getUserId(request), eventId, documentId);
  }
}
