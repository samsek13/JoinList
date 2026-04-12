import { randomBytes, createHash } from "crypto";
import { prisma } from "./db";
import { encryptCookie, decryptCookie } from "./utils";

const CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID!;
const CLIENT_SECRET = process.env.SOUNDCLOUD_CLIENT_SECRET!;
const REDIRECT_URI = process.env.SOUNDCLOUD_REDIRECT_URI!;

// Generate PKCE code_verifier and code_challenge
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

// Generate authorization URL and return state/verifier for storage
export function getAuthorizationUrl(userId: string): {
  url: string;
  state: string;
  verifier: string;
} {
  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString("base64url");

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    state: state,
    code_challenge: challenge,
    code_challenge_method: "S256"
  });

  const url = `https://secure.soundcloud.com/oauth/authorize?${params.toString()}`;

  return { url, state, verifier };
}

// Store OAuth state in database
export async function storeOAuthState(
  userId: string,
  state: string,
  verifier: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await prisma.oAuthState.create({
    data: {
      userId,
      state,
      codeVerifier: verifier,
      expiresAt
    }
  });
}

// Verify and retrieve OAuth state
export async function verifyOAuthState(state: string): Promise<{
  userId: string;
  verifier: string;
} | null> {
  const record = await prisma.oAuthState.findUnique({
    where: { state }
  });

  if (!record) {
    return null;
  }

  // Check expiration
  if (record.expiresAt < new Date()) {
    await prisma.oAuthState.delete({ where: { id: record.id } });
    return null;
  }

  return {
    userId: record.userId,
    verifier: record.codeVerifier
  };
}

// Delete OAuth state after use
export async function deleteOAuthState(state: string): Promise<void> {
  await prisma.oAuthState.delete({ where: { state } });
}

// Exchange code for token
export async function exchangeCodeForToken(
  code: string,
  verifier: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "authorization_code",
      code: code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI
    }).toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`token_exchange_failed: ${text}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token
  };
}

// Get user info from SoundCloud
export async function getSoundCloudUser(accessToken: string): Promise<string> {
  const response = await fetch(`https://api.soundcloud.com/me`, {
    headers: {
      "Authorization": `OAuth ${accessToken}`,
      "accept": "application/json; charset=utf-8"
    }
  });

  if (!response.ok) {
    throw new Error("user_fetch_failed");
  }

  const data = await response.json() as { username?: string; full_name?: string };
  return data.username || data.full_name || "Unknown";
}

// Refresh access token
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const response = await fetch("https://secure.soundcloud.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }).toString()
  });

  if (!response.ok) {
    throw new Error("token_refresh_failed");
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// Store token for user (encrypted)
export async function storeToken(
  userId: string,
  accessToken: string,
  refreshToken: string,
  username: string
): Promise<void> {
  const encryptedAccess = encryptCookie(accessToken);
  const encryptedRefresh = encryptCookie(refreshToken);

  await prisma.user.update({
    where: { id: userId },
    data: {
      soundcloudToken: encryptedAccess,
      soundcloudRefreshToken: encryptedRefresh,
      soundcloudUsername: username
    }
  });
}

// Get decrypted token for user
export async function getDecryptedToken(userId: string): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      soundcloudToken: true,
      soundcloudRefreshToken: true
    }
  });

  if (!user) {
    return { accessToken: null, refreshToken: null };
  }

  return {
    accessToken: user.soundcloudToken
      ? decryptCookie(user.soundcloudToken)
      : null,
    refreshToken: user.soundcloudRefreshToken
      ? decryptCookie(user.soundcloudRefreshToken)
      : null
  };
}
