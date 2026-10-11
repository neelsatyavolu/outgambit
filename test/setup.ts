// Fixed, non-secret values so modules that read the environment work in tests.
process.env.DATABASE_URL ??= "pglite://memory";
process.env.OWNER_PASSWORD ??= "test-owner-password";
process.env.SECRETS_KEY ??= Buffer.alloc(32, 9).toString("base64");
process.env.IP_SALT ??= "test-salt-0123456789";
// Not the address the tests' requests claim to be for: a reset link has to come from here, not from them.
process.env.APP_URL ??= "https://play.gambit.test";
// Tests that send mail put their own fetch in Resend's place.
process.env.RESEND_API_KEY ??= "re_test_key";
