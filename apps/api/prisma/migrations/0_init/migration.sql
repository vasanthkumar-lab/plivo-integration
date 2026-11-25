-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "value" DECIMAL NOT NULL DEFAULT 0,
    "owner_id" TEXT,
    "last_contacted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" TEXT NOT NULL,
    "call_uuid" TEXT NOT NULL,
    "lead_id" TEXT,
    "rep_id" TEXT,
    "direction" TEXT NOT NULL,
    "from_number" TEXT NOT NULL DEFAULT '',
    "to_number" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6),
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "recording_url" TEXT,
    "disposition" TEXT,
    "notes" TEXT,
    "ended_by" TEXT,
    "end_reason" TEXT,
    "transcript_status" TEXT NOT NULL DEFAULT 'none',

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL,
    "meta" JSONB,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcripts" (
    "call_uuid" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'none',
    "provider" TEXT NOT NULL DEFAULT 'deepgram',
    "model" TEXT,
    "language" TEXT,
    "channels" INTEGER NOT NULL DEFAULT 0,
    "roles_are_reliable" BOOLEAN NOT NULL DEFAULT false,
    "duration_sec" DECIMAL NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL DEFAULT '',
    "segments" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("call_uuid")
);

-- CreateIndex
CREATE INDEX "leads_owner_idx" ON "leads"("owner_id");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "leads"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "calls_call_uuid_key" ON "calls"("call_uuid");

-- CreateIndex
CREATE INDEX "calls_lead_idx" ON "calls"("lead_id");

-- CreateIndex
CREATE INDEX "calls_started_idx" ON "calls"("started_at" DESC);

-- CreateIndex
CREATE INDEX "activities_lead_idx" ON "activities"("lead_id", "at" DESC);


-- Full-text search over transcripts.
-- Prisma cannot model an expression index, so it is applied here as raw SQL;
-- without this line a rebuilt database would silently lose the index.
CREATE INDEX IF NOT EXISTS "transcripts_text_idx"
  ON "transcripts" USING GIN (to_tsvector('english', "text"));
