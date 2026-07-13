import "dotenv/config";

const region = (process.env.STORYBLOK_REGION ?? "eu").toLowerCase();

// Storyblok expone la Management API en hosts por región.
const MAPI_HOST: Record<string, string> = {
  eu: "https://mapi.storyblok.com",
  us: "https://api-us.storyblok.com",
  ap: "https://api-ap.storyblok.com",
  ca: "https://api-ca.storyblok.com",
  cn: "https://app.storyblokchina.cn",
};

const openaiKey = process.env.OPENAI_API_KEY ?? "";

export const config = {
  // 'mock' = escribe story + preview en out/ (sin cuenta) · 'storyblok' = publica vía Management API.
  publishMode: (process.env.WEB_PUBLISH_MODE as "mock" | "storyblok") || "mock",

  briefPath: process.env.KR_BRIEF_PATH ?? "../kr-service/out/brief.json",

  businessProfilePath: process.env.BUSINESS_PROFILE_PATH ?? "./business-profile.json",

  openai: {
    apiKey: openaiKey,
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    get hasKey() {
      return Boolean(this.apiKey);
    },
  },

  prose: {
    // 'openai' si hay key (prose real); si no, 'mock' (texto determinista de relleno).
    mode: (process.env.PROSE_MODE as "openai" | "mock") || (openaiKey ? "openai" : "mock"),
  },

  storyblok: {
    managementToken: process.env.STORYBLOK_MANAGEMENT_TOKEN ?? "",
    spaceId: process.env.STORYBLOK_SPACE_ID ?? "",
    region,
    // Escribe el payload que se enviaría (a out/storyblok/) sin llamar a la API.
    dryRun: process.env.STORYBLOK_DRY_RUN === "1" || process.env.STORYBLOK_DRY_RUN === "true",
    get mapiHost() {
      return MAPI_HOST[region] ?? MAPI_HOST.eu!;
    },
    get hasCredentials() {
      return Boolean(this.managementToken && this.spaceId);
    },
  },
} as const;
