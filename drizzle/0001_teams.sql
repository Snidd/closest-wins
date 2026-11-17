ALTER TABLE "game" ADD COLUMN "team_count" integer;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "team_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "team_pick" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game" ADD COLUMN "winner_teams" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "player" ADD COLUMN "team" integer;--> statement-breakpoint
ALTER TABLE "game" ADD CONSTRAINT "game_team_count_ck" CHECK ("game"."team_count" IS NULL OR "game"."team_count" BETWEEN 2 AND 8);--> statement-breakpoint
ALTER TABLE "player" ADD CONSTRAINT "player_team_ck" CHECK ("player"."team" IS NULL OR "player"."team" >= 0);