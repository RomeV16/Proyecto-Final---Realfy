-- CreateTable
CREATE TABLE "inquilino_credentials" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquilino_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_invitations" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inquilino_credentials_personId_key" ON "inquilino_credentials"("personId");

-- CreateIndex
CREATE INDEX "inquilino_credentials_tenantId_idx" ON "inquilino_credentials"("tenantId");

-- CreateIndex
CREATE INDEX "inquilino_credentials_tenantId_isActive_idx" ON "inquilino_credentials"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "portal_refresh_tokens_token_key" ON "portal_refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "portal_refresh_tokens_personId_idx" ON "portal_refresh_tokens"("personId");

-- CreateIndex
CREATE INDEX "portal_refresh_tokens_tenantId_idx" ON "portal_refresh_tokens"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "portal_invitations_token_key" ON "portal_invitations"("token");

-- CreateIndex
CREATE INDEX "portal_invitations_tenantId_idx" ON "portal_invitations"("tenantId");

-- CreateIndex
CREATE INDEX "portal_invitations_token_idx" ON "portal_invitations"("token");

-- AddForeignKey
ALTER TABLE "inquilino_credentials" ADD CONSTRAINT "inquilino_credentials_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_refresh_tokens" ADD CONSTRAINT "portal_refresh_tokens_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

