-- CreateTable
CREATE TABLE "seller_documents" (
    "id" TEXT NOT NULL,
    "seller_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "slot_index" INTEGER,
    "path" TEXT NOT NULL,
    "wrapped_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT NOT NULL,
    "downloaded_at" TIMESTAMP(3),
    "downloaded_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "seller_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_documents_seller_id_doc_type_idx" ON "seller_documents"("seller_id", "doc_type");

-- CreateIndex
CREATE INDEX "seller_documents_seller_id_deleted_at_idx" ON "seller_documents"("seller_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "seller_documents" ADD CONSTRAINT "seller_documents_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
