// Registers the pre-loaded task, processor and email template modules.
// Shared by every server test setup, with or without mocked infrastructure.

import { __setRequireDirectoryCache } from "@server/utils/fs";

// Pre-populate the requireDirectory cache used by @server/utils/fs so that
// tasks/processors/email-templates can be looked up via their pre-loaded
// modules instead of via Node's require(), which cannot resolve TypeScript
// files with aliased imports under Vitest. The eager globs intentionally
// exclude index.ts files (which call requireDirectory themselves and would
// recurse) and any files whose imports would themselves load the directory
// they live in.
__setRequireDirectoryCache(
  "emails/templates",
  import.meta.glob(
    ["../emails/templates/*.{js,ts,tsx}", "!**/index.*", "!**/*.test.*"],
    { eager: true }
  )
);
__setRequireDirectoryCache(
  "queues/processors",
  import.meta.glob(
    ["../queues/processors/*.{js,ts,tsx}", "!**/index.*", "!**/*.test.*"],
    { eager: true }
  )
);
__setRequireDirectoryCache(
  "queues/tasks",
  import.meta.glob(
    ["../queues/tasks/*.{js,ts,tsx}", "!**/index.*", "!**/*.test.*"],
    { eager: true }
  )
);
