-- CreateEnum
CREATE TYPE "NewsletterStatus" AS ENUM ('pending', 'confirmed', 'unsubscribed');

-- CreateEnum
CREATE TYPE "WhatsappOptInStatus" AS ENUM ('pending_verification', 'verified');

-- CreateTable
CREATE TABLE "deal_routes" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "origin_code" CHAR(3) NOT NULL,
    "destination_code" CHAR(3) NOT NULL,
    "cabin_class" "CabinClass" NOT NULL DEFAULT 'economy',
    "stay_nights" INTEGER NOT NULL DEFAULT 7,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deal_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_snapshots" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "supplier" TEXT NOT NULL,
    "departure_date" DATE NOT NULL,
    "return_date" DATE,
    "carrier_code" VARCHAR(3) NOT NULL,
    "carrier_name" TEXT NOT NULL,
    "stops" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "taxes_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "origin_country" CHAR(2) NOT NULL,
    "destination_country" CHAR(2) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destination_contents" (
    "id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "destination_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destination_hotel_snapshots" (
    "id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "supplier" TEXT NOT NULL,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "hotel_count" INTEGER NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "taxes_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destination_hotel_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscriptions" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "NewsletterStatus" NOT NULL DEFAULT 'pending',
    "locale" TEXT NOT NULL DEFAULT 'en-NG',
    "whatsapp_phone" TEXT,
    "whatsapp_status" "WhatsappOptInStatus",
    "consent_version" TEXT NOT NULL,
    "consented_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_ip_hash" TEXT,
    "source" TEXT NOT NULL DEFAULT 'homepage',
    "confirm_token_hash" TEXT,
    "confirm_token_expires_at" TIMESTAMPTZ(3),
    "confirmation_sent_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "unsubscribed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "newsletter_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_routes_slug_key" ON "deal_routes"("slug");

-- CreateIndex
CREATE INDEX "deal_routes_active_sort_order_idx" ON "deal_routes"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "deal_routes_origin_code_destination_code_cabin_class_key" ON "deal_routes"("origin_code", "destination_code", "cabin_class");

-- CreateIndex
CREATE INDEX "deal_snapshots_route_id_fetched_at_idx" ON "deal_snapshots"("route_id", "fetched_at" DESC);

-- CreateIndex
CREATE INDEX "deal_snapshots_fetched_at_idx" ON "deal_snapshots"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "destination_contents_city_id_key" ON "destination_contents"("city_id");

-- CreateIndex
CREATE UNIQUE INDEX "destination_contents_slug_key" ON "destination_contents"("slug");

-- CreateIndex
CREATE INDEX "destination_contents_featured_sort_order_idx" ON "destination_contents"("featured", "sort_order");

-- CreateIndex
CREATE INDEX "destination_hotel_snapshots_destination_id_fetched_at_idx" ON "destination_hotel_snapshots"("destination_id", "fetched_at" DESC);

-- CreateIndex
CREATE INDEX "destination_hotel_snapshots_fetched_at_idx" ON "destination_hotel_snapshots"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscriptions_email_key" ON "newsletter_subscriptions"("email");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscriptions_confirm_token_hash_key" ON "newsletter_subscriptions"("confirm_token_hash");

-- CreateIndex
CREATE INDEX "newsletter_subscriptions_status_idx" ON "newsletter_subscriptions"("status");

-- AddForeignKey
ALTER TABLE "deal_routes" ADD CONSTRAINT "deal_routes_origin_code_fkey" FOREIGN KEY ("origin_code") REFERENCES "airports"("iata_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_routes" ADD CONSTRAINT "deal_routes_destination_code_fkey" FOREIGN KEY ("destination_code") REFERENCES "airports"("iata_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_snapshots" ADD CONSTRAINT "deal_snapshots_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "deal_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destination_contents" ADD CONSTRAINT "destination_contents_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destination_hotel_snapshots" ADD CONSTRAINT "destination_hotel_snapshots_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "destination_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

