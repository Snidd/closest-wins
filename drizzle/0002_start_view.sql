ALTER TABLE "location" ADD COLUMN "start_lat" double precision;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "start_lng" double precision;--> statement-breakpoint
ALTER TABLE "location" ADD COLUMN "start_zoom" double precision;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_start_view_ck" CHECK (("location"."start_lat" IS NULL AND "location"."start_lng" IS NULL AND "location"."start_zoom" IS NULL) OR ("location"."start_lat" IS NOT NULL AND "location"."start_lng" IS NOT NULL AND "location"."start_zoom" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_start_lat_ck" CHECK ("location"."start_lat" BETWEEN -90 AND 90);--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_start_lng_ck" CHECK ("location"."start_lng" BETWEEN -180 AND 180);--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_start_zoom_ck" CHECK ("location"."start_zoom" >= 0);