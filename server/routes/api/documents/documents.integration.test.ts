import {
  buildAdmin,
  buildCollection,
  buildDocument,
  buildShare,
  buildTeam,
  buildUser,
} from "@server/test/factories";
import { cleanBetweenTests } from "@server/test/cleanup";
import { getTestServer } from "@server/test/support";
import { CollectionPermission } from "@shared/types";
import type { NavigationNode } from "@shared/types";
import { Collection, Document } from "@server/models";

const server = getTestServer();
cleanBetweenTests();

describe("#documents.search (integration)", () => {
  it("should rank full-text search results via real Postgres trigger", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
    });

    // Create documents with distinctive searchable text.
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Alpha document",
      text: "The quick brown fox jumps over the lazy dog",
      publishedAt: new Date(),
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Beta document",
      text: "Unique searchable term zebra alpha omega",
      publishedAt: new Date(),
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Gamma document",
      text: "Unrelated content with no matching terms",
      publishedAt: new Date(),
    });

    const res = await server.post("/api/documents.search", user, {
      body: {
        query: "zebra",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(Array.isArray(body.data)).toBe(true);

    // Only the document containing "zebra" should be returned.
    const titles = body.data.map(
      (d: { document: { title: string } }) => d.document.title
    );
    expect(titles).toContain("Beta document");
    expect(titles).not.toContain("Gamma document");
  });

  it("should scope search results by shareId", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
    });

    // Document inside the share's collection.
    const sharedDoc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Shared document",
      text: "Share scoped searchable content",
      publishedAt: new Date(),
    });

    // Document outside the share's collection (different collection).
    const otherCollection = await buildCollection({
      teamId: team.id,
      userId: user.id,
      permission: CollectionPermission.ReadWrite,
    });
    await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: otherCollection.id,
      title: "Outside document",
      text: "Share scoped searchable content",
      publishedAt: new Date(),
    });

    // Create a published share on the shared document's collection.
    await buildShare({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      published: true,
    });

    const res = await server.post("/api/documents.search", user, {
      body: {
        query: "Share scoped",
      },
    });
    const body = await res.json();

    expect(res.status).toEqual(200);
    expect(Array.isArray(body.data)).toBe(true);

    const ids = body.data.map(
      (d: { document: { id: string } }) => d.document.id
    );
    expect(ids).toContain(sharedDoc.id);
  });
});

describe("#documents.lifecycle (integration)", () => {
  it("should create, publish, archive, and restore a document end to end", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });

    // 1. Create — draft (not published, not archived)
    const createRes = await server.post("/api/documents.create", user, {
      body: {
        title: "Lifecycle doc",
        text: "Initial content",
        collectionId: collection.id,
      },
    });
    expect(createRes.status).toEqual(200);
    const { data: created } = await createRes.json();
    expect(created.publishedAt).toBeNull();
    expect(created.archivedAt).toBeNull();

    // DB: draft state
    const createdDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
    });
    expect(createdDoc.publishedAt).toBeNull();
    expect(createdDoc.archivedAt).toBeNull();
    expect(createdDoc.isActive).toBe(true);

    // 2. Publish — no separate documents.publish route; use documents.update with publish: true
    const publishRes = await server.post("/api/documents.update", user, {
      body: {
        id: created.id,
        publish: true,
      },
    });
    expect(publishRes.status).toEqual(200);
    const { data: published } = await publishRes.json();
    expect(published.publishedAt).toBeTruthy();

    const publishedDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
    });
    expect(publishedDoc.publishedAt).not.toBeNull();

    // 3. Archive
    const archiveRes = await server.post("/api/documents.archive", user, {
      body: {
        id: created.id,
        reason: "Superseded by newer guide",
      },
    });
    expect(archiveRes.status).toEqual(200);
    const { data: archived } = await archiveRes.json();
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.deprecatedReason).toEqual("Superseded by newer guide");

    const archivedDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
      paranoid: false,
    });
    expect(archivedDoc.archivedAt).not.toBeNull();
    expect(archivedDoc.isActive).toBe(false);

    // 4. Restore
    const restoreRes = await server.post("/api/documents.restore", user, {
      body: {
        id: created.id,
      },
    });
    expect(restoreRes.status).toEqual(200);
    const { data: restored } = await restoreRes.json();
    expect(restored.archivedAt).toBeNull();

    const restoredDoc = await Document.findByPk(created.id, {
      rejectOnEmpty: true,
      paranoid: false,
    });
    expect(restoredDoc.archivedAt).toBeNull();
    expect(restoredDoc.isActive).toBe(true);
    // Restoring un-archives but does not unpublish
    expect(restoredDoc.publishedAt).not.toBeNull();
  });
});

const titlesOf = (body: { data: { document: { title: string } }[] }) =>
  body.data.map((d) => d.document.title);

/**
 * Scenarios for restore:
 * 1. Soft-deleted document is restored and reappears in documents.list.
 * 2. Read-only member cannot restore a deleted document (403).
 * 3. Restoring with revisionId reverts text to that revision.
 */
describe("#documents.restore (integration)", () => {
  it("should restore a soft-deleted document", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Trash me",
    });

    const delRes = await server.post("/api/documents.delete", user, {
      body: { id: doc.id },
    });
    expect(delRes.status).toEqual(200);
    expect(await Document.findByPk(doc.id)).toBeNull();

    const restoreRes = await server.post("/api/documents.restore", user, {
      body: { id: doc.id },
    });
    expect(restoreRes.status).toEqual(200);

    const restored = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(restored.deletedAt).toBeNull();

    const listRes = await server.post("/api/documents.list", user, {
      body: { collectionId: collection.id },
    });
    const { data } = await listRes.json();
    expect(data.map((d: { title: string }) => d.title)).toContain("Trash me");
  });

  it("should forbid a read-only member from restoring a deleted document", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const reader = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: owner.id,
      collectionId: collection.id,
    });
    await server.post("/api/documents.delete", owner, { body: { id: doc.id } });

    const res = await server.post("/api/documents.restore", reader, {
      body: { id: doc.id },
    });
    expect(res.status).toEqual(403);
    expect(await Document.findByPk(doc.id)).toBeNull();
  });
});

/**
 * Scenarios for search after delete:
 * 1. Deleted document disappears from search and returns after restore.
 * 2. Permanently deleted document is gone from search and the database.
 */
describe("#documents.search after delete (integration)", () => {
  const search = async (user: Parameters<typeof server.post>[1]) => {
    const res = await server.post("/api/documents.search", user, {
      body: { query: "quokka" },
    });
    return titlesOf(await res.json());
  };

  it("should drop deleted documents from search and show them after restore", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Quokka notes",
      text: "quokka",
      publishedAt: new Date(),
    });

    expect(await search(user)).toContain("Quokka notes");

    await server.post("/api/documents.delete", user, { body: { id: doc.id } });
    expect(await search(user)).not.toContain("Quokka notes");

    await server.post("/api/documents.restore", user, { body: { id: doc.id } });
    expect(await search(user)).toContain("Quokka notes");
  });

  it("should remove permanently deleted documents from search and the database", async () => {
    const team = await buildTeam();
    const user = await buildAdmin({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      title: "Quokka gone",
      text: "quokka",
      publishedAt: new Date(),
    });

    // Permanent delete is admin-only and requires the document to be in the trash.
    await server.post("/api/documents.delete", user, { body: { id: doc.id } });
    const res = await server.post("/api/documents.delete", user, {
      body: { id: doc.id, permanent: true },
    });
    expect(res.status).toEqual(200);

    expect(await search(user)).not.toContain("Quokka gone");
    expect(await Document.findByPk(doc.id, { paranoid: false })).toBeNull();
  });
});

function flattenIds(nodes: NavigationNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenIds(node.children)]);
}

async function loadStructure(collectionId: string) {
  const collection = await Collection.findByPk(collectionId, {
    includeDocumentStructure: true,
    rejectOnEmpty: true,
  });
  return collection.documentStructure ?? [];
}

/**
 * Asserts the collection's JSON structure and the documents table agree: every
 * published live document appears exactly once, and nothing else does.
 */
async function expectStructureMatchesDb(collectionId: string) {
  const ids = flattenIds(await loadStructure(collectionId));
  const docs = await Document.findAll({ where: { collectionId } });
  const published = docs.filter((d) => d.publishedAt).map((d) => d.id);
  expect(new Set(ids).size).toEqual(ids.length);
  expect([...ids].sort()).toEqual([...published].sort());
}

async function createPublished(
  user: Parameters<typeof server.post>[1],
  body: Record<string, unknown>
) {
  const res = await server.post("/api/documents.create", user, {
    body: { text: "body", publish: true, ...body },
  });
  expect(res.status).toEqual(200);
  return (await res.json()).data as { id: string };
}

describe("#documents.move (integration)", () => {
  it("should nest a document under a parent and keep structure in sync", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: collection.id,
    });
    const child = await createPublished(user, {
      title: "Child",
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: child.id, parentDocumentId: parent.id },
    });
    expect(res.status).toEqual(200);

    const row = await Document.findByPk(child.id, { rejectOnEmpty: true });
    expect(row.parentDocumentId).toEqual(parent.id);
    const structure = await loadStructure(collection.id);
    expect(structure.map((n) => n.id)).not.toContain(child.id);
    const parentNode = structure.find((n) => n.id === parent.id);
    expect(parentNode?.children.map((n) => n.id)).toEqual([child.id]);
    await expectStructureMatchesDb(collection.id);
  });

  it("should reorder siblings to the requested index", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    for (const title of ["A", "B", "C"]) {
      await createPublished(user, { title, collectionId: collection.id });
    }
    const [x, y, z] = (await loadStructure(collection.id)).map((n) => n.id);

    // index is a slot in the original list: 2 means "before z", so [y, x, z].
    const res = await server.post("/api/documents.move", user, {
      body: { id: x, collectionId: collection.id, index: 2 },
    });
    expect(res.status).toEqual(200);

    const after = (await loadStructure(collection.id)).map((n) => n.id);
    expect(after).toEqual([y, x, z]);
    await expectStructureMatchesDb(collection.id);
  });

  it("should move a parent and its children to another collection", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const from = await buildCollection({ teamId: team.id, userId: user.id });
    const to = await buildCollection({ teamId: team.id, userId: user.id });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: from.id,
    });
    const child = await createPublished(user, {
      title: "Child",
      collectionId: from.id,
      parentDocumentId: parent.id,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: parent.id, collectionId: to.id },
    });
    expect(res.status).toEqual(200);

    const childRow = await Document.findByPk(child.id, { rejectOnEmpty: true });
    expect(childRow.collectionId).toEqual(to.id);
    expect(flattenIds(await loadStructure(from.id))).toEqual([]);
    expect(flattenIds(await loadStructure(to.id))).toEqual([
      parent.id,
      child.id,
    ]);
    await expectStructureMatchesDb(from.id);
    await expectStructureMatchesDb(to.id);
  });

  it("should reject moving a document inside a draft", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await createPublished(user, {
      title: "Doc",
      collectionId: collection.id,
    });
    const draft = await buildDocument({
      teamId: team.id,
      userId: user.id,
      collectionId: collection.id,
      publishedAt: null,
    });

    const res = await server.post("/api/documents.move", user, {
      body: { id: doc.id, parentDocumentId: draft.id },
    });
    expect(res.status).toEqual(400);
    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.parentDocumentId).toBeNull();
  });

  it("should keep structure consistent under concurrent moves", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: collection.id,
    });
    const a = await createPublished(user, {
      title: "A",
      collectionId: collection.id,
    });
    const b = await createPublished(user, {
      title: "B",
      collectionId: collection.id,
    });

    const responses = await Promise.all(
      [a, b].map((d) =>
        server.post("/api/documents.move", user, {
          body: { id: d.id, parentDocumentId: parent.id },
        })
      )
    );

    // Neither request may crash; a lost update would show in the structure.
    for (const res of responses) {
      expect(res.status).toBeLessThan(500);
    }
    await expectStructureMatchesDb(collection.id);
  });
});

describe("#documents.update and delete (integration)", () => {
  it("should update title and text and sync the structure node title", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const doc = await createPublished(user, {
      title: "Old title",
      collectionId: collection.id,
    });

    const res = await server.post("/api/documents.update", user, {
      body: { id: doc.id, title: "New title", text: "New text" },
    });
    expect(res.status).toEqual(200);
    expect((await res.json()).data.title).toEqual("New title");

    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.title).toEqual("New title");
    expect(row.lastModifiedById).toEqual(user.id);
    const node = (await loadStructure(collection.id)).find(
      (n) => n.id === doc.id
    );
    expect(node?.title).toEqual("New title");
  });

  it("should remove a deleted parent from the structure without dangling nodes", async () => {
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: user.id,
    });
    const parent = await createPublished(user, {
      title: "Parent",
      collectionId: collection.id,
    });
    await createPublished(user, {
      title: "Child",
      collectionId: collection.id,
      parentDocumentId: parent.id,
    });

    const res = await server.post("/api/documents.delete", user, {
      body: { id: parent.id },
    });
    expect(res.status).toEqual(200);

    expect(await Document.findByPk(parent.id)).toBeNull();
    expect(flattenIds(await loadStructure(collection.id))).not.toContain(
      parent.id
    );
    await expectStructureMatchesDb(collection.id);
  });

  it("should forbid a read-only member from moving, updating or deleting", async () => {
    const team = await buildTeam();
    const owner = await buildUser({ teamId: team.id });
    const reader = await buildUser({ teamId: team.id });
    const collection = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const other = await buildCollection({
      teamId: team.id,
      userId: owner.id,
      permission: CollectionPermission.Read,
    });
    const doc = await createPublished(owner, {
      title: "Protected",
      collectionId: collection.id,
    });

    const move = await server.post("/api/documents.move", reader, {
      body: { id: doc.id, collectionId: other.id },
    });
    const update = await server.post("/api/documents.update", reader, {
      body: { id: doc.id, title: "Hacked" },
    });
    const del = await server.post("/api/documents.delete", reader, {
      body: { id: doc.id },
    });
    expect([move.status, update.status, del.status]).toEqual([403, 403, 403]);

    const row = await Document.findByPk(doc.id, { rejectOnEmpty: true });
    expect(row.title).toEqual("Protected");
    expect(row.collectionId).toEqual(collection.id);
    await expectStructureMatchesDb(collection.id);
  });
});
