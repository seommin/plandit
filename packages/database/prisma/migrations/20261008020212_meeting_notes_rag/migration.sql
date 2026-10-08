-- pgvector (the postgres image is pgvector/pgvector; CI uses the same)
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PROCESSING', 'READY');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "charCount" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "embedding" vector(384),

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventEmbedding" (
    "eventId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventEmbedding_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "Document_eventId_idx" ON "Document"("eventId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentId_seq_key" ON "DocumentChunk"("documentId", "seq");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventEmbedding" ADD CONSTRAINT "EventEmbedding_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nearest-neighbour search by cosine distance (embeddings are normalised)
CREATE INDEX "DocumentChunk_embedding_idx" ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "EventEmbedding_embedding_idx" ON "EventEmbedding" USING hnsw ("embedding" vector_cosine_ops);
