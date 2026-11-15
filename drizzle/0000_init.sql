CREATE TABLE "game" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"join_code" text NOT NULL,
	"playlist_id" uuid,
	"language" text NOT NULL,
	"timer_seconds" integer NOT NULL,
	"round_count" integer NOT NULL,
	"selection" text NOT NULL,
	"shuffle" boolean DEFAULT false NOT NULL,
	"phase" text DEFAULT 'lobby' NOT NULL,
	"current_round" integer,
	"reveal_started_at" timestamp with time zone,
	"reveal_skipped_at" timestamp with time zone,
	"winner_player_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"ended_early" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_join_code_ck" CHECK ("game"."join_code" ~ '^[A-Z]{4}$'),
	CONSTRAINT "game_language_ck" CHECK ("game"."language" IN ('sv', 'en')),
	CONSTRAINT "game_selection_ck" CHECK ("game"."selection" IN ('first', 'random')),
	CONSTRAINT "game_phase_ck" CHECK ("game"."phase" IN ('lobby', 'round', 'reveal', 'standings', 'finished')),
	CONSTRAINT "game_timer_ck" CHECK ("game"."timer_seconds" BETWEEN 5 AND 600),
	CONSTRAINT "game_round_count_ck" CHECK ("game"."round_count" >= 1)
);
--> statement-breakpoint
CREATE TABLE "game_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"location_id" uuid NOT NULL,
	"is_sudden_death" boolean DEFAULT false NOT NULL,
	"eligible_player_ids" uuid[],
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"winner_player_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "game_round_index_ck" CHECK ("game_round"."index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guess" (
	"round_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"touched" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"distance_km" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guess_pk" PRIMARY KEY("round_id","player_id"),
	CONSTRAINT "guess_lat_ck" CHECK ("guess"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "guess_lng_ck" CHECK ("guess"."lng" BETWEEN -180 AND 180),
	CONSTRAINT "guess_distance_ck" CHECK ("guess"."distance_km" IS NULL OR "guess"."distance_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "location" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_sv" text,
	"name_en" text,
	"clue_text_sv" text,
	"clue_text_en" text,
	"fact_sv" text,
	"fact_en" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"photo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_name_ck" CHECK ((name_sv IS NOT NULL AND btrim(name_sv) <> '') OR (name_en IS NOT NULL AND btrim(name_en) <> '')),
	CONSTRAINT "location_clue_ck" CHECK ("location"."photo_id" IS NOT NULL OR (clue_text_sv IS NOT NULL AND btrim(clue_text_sv) <> '') OR (clue_text_en IS NOT NULL AND btrim(clue_text_en) <> '')),
	CONSTRAINT "location_lat_ck" CHECK ("location"."lat" BETWEEN -90 AND 90),
	CONSTRAINT "location_lng_ck" CHECK ("location"."lng" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"source_url" text,
	"attribution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "photo_dimensions_ck" CHECK ("photo"."width" > 0 AND "photo"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "player" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"color" text NOT NULL,
	"token_hash" text NOT NULL,
	"kicked" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_nickname_ck" CHECK (char_length("player"."nickname") BETWEEN 1 AND 64),
	CONSTRAINT "player_color_ck" CHECK ("player"."color" ~ '^#[0-9a-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "playlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_sv" text,
	"name_en" text,
	"default_timer_seconds" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_name_ck" CHECK ((name_sv IS NOT NULL AND btrim(name_sv) <> '') OR (name_en IS NOT NULL AND btrim(name_en) <> '')),
	CONSTRAINT "playlist_timer_ck" CHECK ("playlist"."default_timer_seconds" BETWEEN 5 AND 600)
);
--> statement-breakpoint
CREATE TABLE "playlist_item" (
	"playlist_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "playlist_item_pk" PRIMARY KEY("playlist_id","location_id"),
	CONSTRAINT "playlist_item_position_ck" CHECK ("playlist_item"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tv_screen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"pairing_code" text,
	"code_expires_at" timestamp with time zone,
	"game_id" uuid,
	"paired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tv_screen_pairing_code_ck" CHECK ("tv_screen"."pairing_code" IS NULL OR "tv_screen"."pairing_code" ~ '^[0-9]{6}$')
);
--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_playlist_id_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlist"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_round" ADD CONSTRAINT "game_round_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_round" ADD CONSTRAINT "game_round_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guess" ADD CONSTRAINT "guess_round_id_game_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."game_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guess" ADD CONSTRAINT "guess_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."player"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location" ADD CONSTRAINT "location_photo_id_photo_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_item" ADD CONSTRAINT "playlist_item_playlist_id_playlist_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlist"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_item" ADD CONSTRAINT "playlist_item_location_id_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tv_screen" ADD CONSTRAINT "tv_screen_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."game"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_join_code_active_uq" ON "game" USING btree ("join_code") WHERE "game"."phase" <> 'finished';--> statement-breakpoint
CREATE INDEX "game_join_code_idx" ON "game" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "game_phase_idx" ON "game" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "game_created_at_idx" ON "game" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_round_game_index_uq" ON "game_round" USING btree ("game_id","index");--> statement-breakpoint
CREATE INDEX "game_round_location_idx" ON "game_round" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "game_round_active_idx" ON "game_round" USING btree ("ends_at") WHERE "game_round"."started_at" IS NOT NULL AND "game_round"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "guess_player_idx" ON "guess" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "location_photo_idx" ON "location" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "location_updated_at_idx" ON "location" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "photo_file_key_uq" ON "photo" USING btree ("file_key");--> statement-breakpoint
CREATE UNIQUE INDEX "player_game_nickname_uq" ON "player" USING btree ("game_id",lower("nickname"));--> statement-breakpoint
CREATE UNIQUE INDEX "player_token_hash_uq" ON "player" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_item_position_uq" ON "playlist_item" USING btree ("playlist_id","position");--> statement-breakpoint
CREATE INDEX "playlist_item_location_idx" ON "playlist_item" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tv_screen_token_hash_uq" ON "tv_screen" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tv_screen_pairing_code_uq" ON "tv_screen" USING btree ("pairing_code") WHERE "tv_screen"."pairing_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "tv_screen_game_idx" ON "tv_screen" USING btree ("game_id");