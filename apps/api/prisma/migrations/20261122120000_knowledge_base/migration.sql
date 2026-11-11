-- The assistant's knowledge base (ADR-105): documents staff upload and their passages, found
-- with PostgreSQL full-text search. New tables only.
-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "audience" VARCHAR(16) NOT NULL,
    "language" VARCHAR(8) NOT NULL,
    "media_type" VARCHAR(40) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "storage_key" VARCHAR(200) NOT NULL,
    "chunk_count" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "heading" VARCHAR(160),
    "body" TEXT NOT NULL,
    "search" tsvector NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_documents_archived_at_audience_language_idx" ON "knowledge_documents"("archived_at", "audience", "language");

-- CreateIndex
CREATE INDEX "knowledge_documents_sha256_idx" ON "knowledge_documents"("sha256");

-- CreateIndex
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING GIN ("search");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_position_key" ON "knowledge_chunks"("document_id", "position");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

