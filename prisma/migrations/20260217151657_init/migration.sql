-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "platform" TEXT NOT NULL,
    "cookie" TEXT,
    "lastLoginTime" DATETIME NOT NULL
);
INSERT INTO "new_User" ("cookie", "id", "lastLoginTime", "platform") SELECT "cookie", "id", "lastLoginTime", "platform" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
