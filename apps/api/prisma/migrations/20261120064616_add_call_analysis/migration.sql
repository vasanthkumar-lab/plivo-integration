-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "analysis_status" TEXT NOT NULL DEFAULT 'none';

-- CreateTable
CREATE TABLE "call_analyses" (
    "call_uuid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'none',
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT,
    "outcome" TEXT,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DECIMAL NOT NULL DEFAULT 0,
    "summary" TEXT NOT NULL DEFAULT '',
    "signals" JSONB NOT NULL DEFAULT '[]',
    "objections" JSONB NOT NULL DEFAULT '[]',
    "next_steps" JSONB NOT NULL DEFAULT '[]',
    "sentiment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "call_analyses_pkey" PRIMARY KEY ("call_uuid")
);
