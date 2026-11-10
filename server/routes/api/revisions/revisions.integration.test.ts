import { Revision, Document } from "@server/models";
import { buildTeam, buildUser, buildDocument } from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";
import initWorker from "@server/services/worker";

const server = getTestServer();
cleanBetweenTests();

/**
 * Start the worker service so Bull event queues (globalEventQueue,
 * processorEventQueue) are processed. Without this, `documents.update`
 * events are persisted but never consumed by RevisionsProcessor, so no
 * revision rows are ever created asynchronously.
 */
beforeAll(async () => {
  await initWorker();
});

/**
 * Polls for the latest revision of a document until it appears or timeout.
 * Revision creation is async (debounced through the Bull queue), so we must
 * poll rather than assert immediately after the API returns.
 *
 * @param documentId The document id to find the latest revision for
 * @param timeoutMs Maximum time to wait in milliseconds
 * @returns The latest revision once it exists
 * @throws If no revision appears within the timeout
 */
async function waitForLatestRevision(
  documentId: string,
  timeoutMs = 15000
): Promise<Revision> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const revision = await Revision.findLatest(documentId);
    if (revision) {
      return revision;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No revision found for document ${documentId} within ${timeoutMs}ms`
  );
}

describe("#revisions (integration)", () => {
  it("should create a revision asynchronously after documents.update", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: user.id,
      title: "Original title",
      text: "Original content",
    });

    // No revision exists immediately after document creation (no update event yet).
    expect(await Revision.count()).toEqual(0);

    const res = await server.post("/api/documents.update", user, {
      body: {
        id: document.id,
        title: "Updated title",
        text: "Updated content",
        done: true,
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.title).toEqual("Updated title");

    // Revision does not exist synchronously after the API returns — it is
    // created by the background queue worker.
    expect(await Revision.count()).toEqual(0);

    // Worker processes the event asynchronously; poll until visible.
    const revision = await waitForLatestRevision(document.id);

    expect(revision.title).toEqual("Updated title");
    expect(revision.documentId).toEqual(document.id);
    expect(revision.userId).toEqual(user.id);

    // DB row assertion in the same test.
    const persisted = await Revision.findByPk(revision.id, {
      rejectOnEmpty: true,
    });
    expect(persisted.title).toEqual("Updated title");
    expect(JSON.stringify(persisted.content)).toContain("Updated content");
  });

  it("should not create duplicate revisions for identical updates", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: user.id,
      title: "Same title",
      text: "Same content",
    });

    const update = () =>
      server.post("/api/documents.update", user, {
        body: {
          id: document.id,
          title: "Same title",
          text: "Same content",
          done: true,
        },
      });

    // Send the updates one after another: concurrent identical updates race in
    // RevisionsProcessor (both read "no previous revision") and store two rows,
    // see the issue #26 analysis. This test covers the sequential dedup path.
    await update();
    await waitForLatestRevision(document.id, 30000);
    await update();

    // shortcut: fixed settle time, the queue exposes no "job done" signal here.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Exactly one revision row — identical updates are deduped.
    const count = await Revision.count({ where: { documentId: document.id } });
    expect(count).toEqual(1);

    const revision = await Revision.findLatest(document.id);
    expect(JSON.stringify(revision!.content)).toContain("Same content");
  });

  it("should restore a document to a specific revision", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const document = await buildDocument({
      teamId: team.id,
      userId: user.id,
      title: "Original",
      text: "Original content",
    });

    // Create a first revision by updating the document.
    await server.post("/api/documents.update", user, {
      body: {
        id: document.id,
        title: "Original",
        text: "Original content",
        done: true,
      },
    });
    await waitForLatestRevision(document.id);

    const firstRevision = await Revision.findLatest(document.id);
    expect(firstRevision).not.toBeNull();

    // Change the document to create a second revision.
    await server.post("/api/documents.update", user, {
      body: {
        id: document.id,
        title: "Modified",
        text: "Modified content",
        done: true,
      },
    });

    // Wait for the async revision from the second update.
    await waitForLatestRevision(document.id, 15000);

    // Restore the document to the first revision.
    const res = await server.post("/api/documents.restore", user, {
      body: { id: document.id, revisionId: firstRevision!.id },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(body.data.title).toEqual("Original");

    // DB row: document content reverted to the revision's snapshot.
    const restored = await Document.findByPk(document.id, {
      rejectOnEmpty: true,
    });
    expect(restored.title).toEqual("Original");
    expect(restored.text).toContain("Original content");
  });
});
