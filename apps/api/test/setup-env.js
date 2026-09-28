const { testDatabaseUrl, testRedisUrl } = require("./test-env");

// Runs before each test file's imports, so the Prisma/Redis singletons connect to the test stores.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.DIRECT_URL = testDatabaseUrl();
process.env.REDIS_URL = testRedisUrl();
