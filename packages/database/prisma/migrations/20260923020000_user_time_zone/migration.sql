-- NULL means follow the current device. Never infer a historical user's location.
ALTER TABLE "user_preferences" ADD COLUMN "timeZone" TEXT;
